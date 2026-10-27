# Real-Time Facial Recognition Scanner — Implementation Plan

Based on a Google AI Mode research conversation (2026-08-15). This captures the
architecture and decisions made, plus the concrete build plan.

## Objective

This is a **watch-list alerting system**, not access control. `MonitoringProfile`
rows are people of interest — the system should raise an alert when one of them
is _detected_ in the video feed. This is the reverse of the original face-api.js
draft's "grant access to a known employee" framing, and it changes which branch
of a match triggers the alert (see Architecture/Phase 3 below).

Profile images are sourced from whatever public photos of the person can be
found — social media (Facebook, etc.), not a controlled photo shoot. That has
real consequences for enrollment: variable resolution/compression, arbitrary
angle/lighting, sometimes sunglasses/filters/group shots, and often only a
single usable photo per person rather than several. The plan needs to treat
single-image enrollment as the _normal_ case, not an edge case.

## Decisions made in the conversation

| Decision point             | Choice                                                                                                                                                                                                                                                                                                                                                                                                                  |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Deployment target          | Local PC (not edge hardware — Jetson/Pi ruled out)                                                                                                                                                                                                                                                                                                                                                                      |
| Identification scenario    | **Facial recognition** (not plain person detection, not Re-ID)                                                                                                                                                                                                                                                                                                                                                          |
| Alert model                | **Watch-list**: alert fires when a monitored person _is_ detected, not when someone is unrecognized                                                                                                                                                                                                                                                                                                                     |
| Camera framing             | Close-up (doorway/turnstile entry), not wide-angle overhead                                                                                                                                                                                                                                                                                                                                                             |
| Monitoring profiles count  | Under 50 people                                                                                                                                                                                                                                                                                                                                                                                                         |
| Profile image source       | Public/social-media photos of the person — uncontrolled quality/angle, often a single image per profile                                                                                                                                                                                                                                                                                                                 |
| Runtime                    | **Node.js** (not Python)                                                                                                                                                                                                                                                                                                                                                                                                |
| Recognition library        | **OpenCV** via Node bindings (not face-api.js/TensorFlow.js)                                                                                                                                                                                                                                                                                                                                                            |
| Detection model            | **YuNet** (ONNX, via generic `cv.dnn` — `@u4/opencv4nodejs` confirmed not to bind `FaceDetectorYN`) — not Haar cascade                                                                                                                                                                                                                                                                                                  |
| Recognition model          | **SFace** (ONNX, via generic `cv.dnn` — confirmed not to bind `FaceRecognizerSF`) — not LBPH — outputs a 128-d embedding per face                                                                                                                                                                                                                                                                                       |
| Video ingestion            | OpenCV `VideoCapture` (native ffmpeg-backed videoio)                                                                                                                                                                                                                                                                                                                                                                    |
| Monitoring profile storage | **Two Postgres tables** via Prisma — `MonitoringProfile` (name, `isTest` flag) 1-to-many `MonitoringProfileImage` (image blob **+ its own SFace embedding**) — one embedding per image, not aggregated to a single per-person vector                                                                                                                                                                                    |
| Test vs. real profiles     | `isTest` flag on `MonitoringProfile` — test profiles are used only by the calibration "test match" flow and are fully excluded from the live alert pipeline's match set                                                                                                                                                                                                                                                 |
| Video feed source config   | **DB-backed** (Postgres via Prisma), managed through `security-server-ui` — not a single `CAMERA_SOURCE` env var. Schema: name + `type` (RTSP/USB) + enabled flag + a **JSONB `config` column** for type-specific fields, rather than fixed columns per type. No encryption-at-rest for credentials (redaction only); `config` validated by a **Zod schema keyed by `type`**; seeded webcam channel starts **disabled** |
| Similarity threshold       | **Cosine similarity**, ships with SFace's hardcoded reference default; **calibratable per channel** via a nullable `similarityThreshold` column (null = use the default), set through a "test match" UI flow rather than a raw number field                                                                                                                                                                             |
| Alert history storage      | New **`Alert`** Postgres table via Prisma — `timestamp` + FK to `MonitoringProfile` + FK to the video feed source ("channel") — separate from the notification-channel question, still open                                                                                                                                                                                                                             |
| Vector matching location   | **In-memory** (not per-frame pgvector queries) — negligible cost at this scale. Revisit only if embedding count reaches the order of tens of thousands (see Phase 1)                                                                                                                                                                                                                                                    |
| Embedding storage type     | **`vector(128)`** (pgvector), not plain array/JSON — future-proofs for DB-side matching later, even though matching stays in-memory now. Already backed by existing infra (`pgvector/pgvector:pg18` image + `init.sql` extension setup); Prisma-side wiring (`previewFeatures`, `Unsupported("vector(128)")` + raw SQL for this column) is still new work                                                               |
| Distribution               | Docker container                                                                                                                                                                                                                                                                                                                                                                                                        |

## Architecture

```
[ RTSP / USB camera ]
        │
        ▼
   cv.VideoCapture(CAMERA_SOURCE)
   libopencv_videoio (ffmpeg/gstreamer backend, reads RTSP/USB natively)
        │  (cv.Mat frame, pulled in a read loop)
        ▼
   Node.js frame handler
        │
        ▼
   YuNet (ONNX, via cv.dnn.readNetFromONNX)
   manual pre/post-process → face bounding box + 5 landmarks
        │
        ▼
   SFace (ONNX, via cv.dnn.readNetFromONNX)
   manual align + forward() → 128-d embedding
        │
        ▼
   manual cosine similarity vs. embeddings loaded from Postgres (<50 profiles)
        │
        ├─ match found  → ALERT: monitored person "<name>" detected
        └─ no match     → no action (not a monitored profile)
```

**Node binding**: `opencv4nodejs` is unmaintained upstream — use the maintained
fork **`@u4/opencv4nodejs`**, which is what the plan below assumes. **Confirmed
(checked directly against its typings on GitHub)**: it does **not** wrap
`FaceDetectorYN`/`FaceRecognizerSF` — only the classic `face` module
(LBPH/Eigenface/Fisherface/CascadeClassifier). The generic `cv.dnn` path is
the way YuNet/SFace get used here, not a fallback contingent on a check.

## Build plan

### Phase 1 — Core recognition engine

- Scaffold Node.js project; install `@u4/opencv4nodejs`. **Confirmed via its
  typings on GitHub**: no `FaceDetectorYN`/`FaceRecognizerSF` bindings exist,
  so YuNet/SFace go through the generic `cv.dnn` module instead —
  `readNetFromONNX()` to load each model, `blobFromImage()` to preprocess,
  `Net.setInput()`/`Net.forward()` to run inference. This is real, confirmed
  extra work versus a dedicated wrapper class, but one piece of it is less
  work than expected: `NMSBoxes()` (non-max suppression) is already present
  as a ready-made utility, which is normally the fiddliest part of manually
  decoding YuNet's anchor-based output.
- Detection: **YuNet** — a small ONNX face detector, meaningfully more
  accurate than a Haar cascade at the angle/lighting variance a real doorway
  camera will see. Its raw output needs manual decoding into bounding boxes,
  confidence scores, and 5 facial landmarks (used to align the crop before
  it's handed to the recognizer) — there's no dedicated class doing this for
  you, per the binding-coverage finding above.
- Recognition: **SFace** — a small ONNX embedding network. Running it through
  `cv.dnn` and reading the output gives a **128-d embedding vector** per
  aligned face crop; cosine similarity between two embeddings is then
  computed manually (a normalized dot product — simple, unlike the YuNet
  decoding step). Both YuNet and SFace ship as `.onnx` model files (from the
  `opencv_zoo` project) that need to be bundled with the app — they aren't
  part of the `opencv`/`opencv-dev` apk packages, since those only cover the
  compiled OpenCV libraries, not model assets.
- Monitoring profile images live in Postgres (via Prisma) as blobs, not a
  `known_faces/` filesystem folder — see the "Monitoring profiles" section
  below for the two-table shape (`MonitoringProfile` 1-to-many
  `MonitoringProfileImage`).
- Enrollment step: at startup (and whenever a profile or its images change),
  load every `MonitoringProfileImage` row joined to its parent
  `MonitoringProfile` **where `isTest: false`** (test profiles are excluded
  from this set entirely, see "Monitoring profiles" below), decode each
  image's bytes into a `cv.Mat`, run YuNet to detect + align the face, then
  SFace `.feature()` to get its 128-d embedding — no training step at all,
  unlike LBPH. Keep an in-memory list of `(embedding, MonitoringProfile.id/
name)` pairs, one entry per `MonitoringProfileImage`, to compare incoming
  frames against during live monitoring.
- **Matching stays in-memory, not per-frame pgvector queries** — even at
  ~150 stored embeddings (current scale), a brute-force cosine comparison
  against all of them is on the order of 150–300 _microseconds_ total,
  negligible next to the YuNet+SFace inference cost that already runs every
  frame. Querying pgvector per detected face would add a real network
  round-trip to Postgres for no algorithmic benefit — pgvector's ANN
  indexes (IVFFlat/HNSW) only start earning their keep somewhere in the
  tens-of-thousands-of-vectors range, and even pgvector's own brute-force
  scan needs no index below that. Rough rule of thumb for revisiting this:
  10,000 vectors ≈ 10–20ms per detected face (still fine, no longer free);
  100,000 ≈ 100–200ms (now a real bottleneck, worth benchmarking a
  pgvector-backed approach instead). Given this system is scoped to <50
  profiles, that's a 200×–1000× scale change away — not a near-term
  concern. The embedding column is still stored as pgvector's `vector(128)`
  type regardless (see "Monitoring profiles" below) — that's a schema
  future-proofing decision, independent of where matching actually runs
  today.
- Matching: call `.match()` in **cosine similarity** mode (not L2 distance) —
  higher score means more similar, bounded roughly 0–1, which is the more
  intuitive metric to expose to a non-technical admin during calibration (see
  below). Ships with SFace's documented reference default (cosine ≳0.36 for
  `sface_2021dec`) as a hardcoded fallback, but the threshold is
  **calibratable per channel** — see the `similarityThreshold` column and the
  test-match calibration flow in the "Video feed sources" section below. At
  match time: look up the detecting channel's threshold; if it hasn't been
  calibrated (null), fall back to the hardcoded SFace default.

### Phase 2 — Live video ingestion

- Use `cv.VideoCapture(source)` directly — `libopencv_videoio` is built
  against ffmpeg/gstreamer and reads RTSP URLs or a local device (`/dev/video0`)
  natively, so no manual FFmpeg child-process/JPEG-piping layer is needed
  (this replaces the FFmpeg-piping approach from the face-api.js draft of this
  plan). The `source` string/index passed to `VideoCapture` is built at
  runtime from a video feed source row's `type` + JSONB `config` (e.g. an RTSP
  URL assembled from `config`'s host/credentials, or a USB device index/path
  read straight from it) — not a literal env var.
- Read loop: `cap.read()` per frame; downscale with `frame.resize()` and skip
  frames (e.g. process every 3rd) to cap effective FPS and CPU load for a
  close-up doorway feed.
- Auto-reconnect: if `cap.read()` starts returning empty frames (stream drop),
  release and re-open the `VideoCapture` on a backoff timer.
- `ffmpeg`/`gstreamer` remain **system-level** dependencies (pulled in by
  `libopencv_videoio`), even though there's no more application code that
  shells out to the `ffmpeg` CLI directly.

### Phase 3 — Alert pipeline

- Wire `triggerAlertPipeline()` for the "match found" branch — a monitored
  person was detected, which is the entire point of the system. An unmatched
  face is a no-op (they're not someone this system has been asked to watch
  for); this is the inverse of the original face-api.js draft's "unknown
  face is suspicious" access-control framing.
- First step of the pipeline: insert an `Alert` row (timestamp, the matched
  `MonitoringProfile`, the `channel`/video feed source the detection came
  from) — see the new "Alerts" section below. This happens regardless of
  which notification channel is chosen next.
- **For now, the "notification" is an Alerts page in `security-server-ui`**
  that lists `Alert` rows — no push-style channel (audio/SMS/webhook/email)
  is being built yet. Someone has to actively check the page to see a
  detection; there's no active/interruptive notification.
- **Open decision (not yet made in the conversation):** notification channel —
  local audio alarm, append to a log file, webhook, SMS (e.g. Twilio), or email.
  Needs a choice before this phase can be finished.

### Phase 4 — Containerization & distribution

- The `node:22.17.0-alpine3.22` base image already used by
  `packages/security-server` ships prebuilt OpenCV 4.11 apk packages
  (`opencv-dev` for headers/pkg-config, `opencv` + individual `libopencv_*`
  runtime `.so`s) — confirmed via `apk search`/`apk info` against that exact
  image. This avoids compiling OpenCV from source, which is the normally
  painful part of an `opencv4nodejs`-based setup.
- Build stage: `apk add opencv-dev` (pulls in the dev headers plus every
  `libopencv_*` runtime lib as a dependency) alongside the existing native
  build toolchain (`build-base`, `g++`, `python3`, `pkgconfig`) so
  `@u4/opencv4nodejs` can compile its bindings against the system install
  instead of triggering its own OpenCV source build — set
  `OPENCV4NODEJS_DISABLE_AUTOBUILD=1` plus `OPENCV_INCLUDE_DIR`/`OPENCV_LIB_DIR`
  pointed at the apk-installed paths.
- Production stage: `apk add opencv` (pulls in the runtime `libopencv_*.so`s
  needed by the compiled bindings copied over from the build stage) — no
  separate `ffmpeg` package needed, since `libopencv_videoio`'s own
  dependencies already cover it.
- `.dockerignore` excludes `node_modules` and `.git`; there's no
  `known_faces/*` folder to worry about baking into the image anymore now
  that face images live in Postgres — the existing `postgres` service in
  `docker-compose.*.yml` is the only place the private face data needs to be
  reachable from, no extra volume mount required for it.
- The YuNet and SFace `.onnx` model files (small, a few MB combined) need to
  be copied into the image alongside the app code — they're static assets
  bundled with the repo, not something `apk` provides or something fetched
  at container startup.
- Camera source(s) are no longer a single build/run-time env var — they're
  rows in the video feed sources table (see new section below), managed
  through the UI. USB device passthrough still needs a Docker-level knob
  (e.g. `--device=/dev/video0:/dev/video0`) since that's a host/container
  boundary concern no DB config can remove.
- CPU-only image is the default target (matches the close-up/<50-people scale;
  no GPU passthrough needed for this workload). GPU/NVIDIA Container Toolkit
  path is documented as a future option only if multi-camera throughput becomes
  a requirement.

## Video feed sources (config & management)

The engine needs to support more than one camera, and cameras shouldn't be
hardcoded — this is the first piece of the DB layer to design, ahead of the
monitoring profiles tables.

- **Storage**: video feed source configuration (not the video itself) lives in
  Postgres via Prisma, alongside the monitoring profiles tables. Decided
  shape: a name/label, a `type` column (`RTSP` or `USB`), an enabled/disabled
  flag, a `removable` flag (see default webcam channel below), a nullable
  `similarityThreshold` column (see below), and a **JSONB `config` column**
  holding whatever fields are specific to that type — rather than separate
  rigid columns trying to cover both RTSP and USB connection details up
  front. This sidesteps needing to know the exact camera hardware ahead of
  time: the schema doesn't need to change as different camera brands/setups
  come along later, since their differences live inside the JSON blob, not
  the table structure.
- **Per-channel similarity threshold, calibratable**: ships with SFace's
  documented default (hardcoded in the app) rather than a value stored for
  every channel up front — `similarityThreshold` starts `null`, meaning "use
  the hardcoded default." It's stored (and displayed) as a **cosine
  similarity** score. This is scoped per-channel rather than globally because
  the thing being compensated for — a specific camera's real-world image
  quality — is a property of the camera, not of the system as a whole or of
  any one monitoring profile.
- **Calibration is a "test match" flow, not a raw number field**: the admins
  using this aren't expected to understand what a cosine similarity score
  means in the abstract, so the UI doesn't just hand them a number box.
  Instead, from a channel's page, an admin can run a live test: point the
  camera at a real person enrolled as a **test profile** (`isTest: true` —
  see "Monitoring profiles" below), capture a frame, run it through YuNet +
  SFace, and see the actual computed score against that profile's stored
  embedding(s) right there. Seeing a concrete "this test profile scored 0.51
  just now" is what the admin uses to decide where to set
  `similarityThreshold` for that channel — the raw number still gets stored,
  but it's arrived at by observation, not guesswork. Test profiles exist
  specifically so this calibration step can never accidentally compare
  against (or trigger an alert against) a real watch-list profile.
- **Management UI is type-driven**: the add/edit form first asks for a
  name and a type (RTSP or USB); once the admin picks one, the form reveals
  the follow-up fields relevant to that type (e.g. RTSP → host/URL,
  credentials; USB → device path/index) and posts them as the `config` JSON.
  This means the exact camera hardware doesn't need to be known at plan-time
  — the UI adapts per-source, at creation time, instead.
- **Probe first, manual input as fallback**: rather than always asking the
  admin to type in every field, the backend first tries to auto-detect what
  it can — e.g. enumerate available USB devices, or open a device/RTSP
  stream and read back its actual resolution/FPS — and only falls back to a
  manual text field when probing doesn't yield a usable value. This is the
  same underlying mechanism as the "Verification" step below (open the
  capture, read from it), just run earlier/opportunistically during
  add/edit rather than only as a separate confirm step. Concretely:
  - **USB**: if the host/OS lets OpenCV enumerate connected camera devices,
    present them as a pick-list instead of a free-text device index/path;
    resolution/FPS can likewise be probed once a device is selected. If
    enumeration isn't available (this is OS-specific — v4l2 on Linux vs.
    DirectShow on Windows vs. AVFoundation on Mac — and not guaranteed to be
    exposed by `@u4/opencv4nodejs`), fall back to a manual device index/path
    field.
  - **RTSP**: there's no discovery mechanism for finding a camera on the
    network — host, port, path, and credentials always have to be entered
    manually. What _can_ be probed, once a URL is supplied, is the stream's
    actual resolution/FPS by briefly opening it — so those fields don't need
    to be asked for manually even though the connection details do.
- **Management UI**: new pages in `security-server-ui` to list, add, edit, and
  remove video feed sources — a straightforward CRUD screen backed by new API
  endpoints on `security-server`.
- **Default webcam channel, for testing**: one `type: USB` row (pointing at
  the host's default webcam, e.g. device index 0) is seeded automatically —
  via a Prisma seed script, not through the admin "add channel" form — rather
  than requiring an admin to manually create it. It's an ordinary row in
  every other respect (can be enabled/disabled like any other channel) except
  it's marked `removable: false`, so the UI hides/disables its delete action
  and the API rejects deleting it — it can always be toggled off, but not
  removed outright. This is a convenience for local development/testing
  against a laptop webcam, separate from any real deployment cameras.
  `removable` is specifically for this one seeded row — it's not a
  general-purpose setting exposed to admins for arbitrary channels.
- **Deleting any other channel is blocked if it has alert history**: once a
  channel has one or more `Alert` rows referencing it (via `Alert.channelId`),
  it can't be deleted — only disabled — to preserve referential integrity of
  the alert log (an `Alert` should always be able to say which channel it
  came from, not point at a deleted row or a nulled-out reference). This is
  independent of the `removable` flag above, and applies to every
  admin-created RTSP/USB channel. In practice this is a Postgres FK
  constraint without cascade delete on `Alert.channelId` — the database
  itself rejects the delete, and the API translates that into a clear error
  rather than a raw constraint-violation message.
- **Verification**: before (or after) saving a source, the UI triggers a
  "verify" action against the backend that attempts to actually open the feed
  — `cv.VideoCapture(source)` + a single `cap.read()` — and reports back
  reachable/unreachable (and ideally a preview frame) rather than just
  validating the form fields. This is what turns "looks like a valid RTSP
  URL" into "this camera is actually usable by the recognition engine."
- **RTSP vs USB differ operationally, but "verify" stays at the minimum bar
  for both**: open the feed, read one frame, report reachable/unreachable —
  no deeper check (e.g. confirming a face-sized region is resolvable at the
  camera's real mounting distance) for either type. RTSP is a pure network
  check (URL, credentials, reachability over the network from wherever the
  container runs). USB is a host/container boundary problem — the device has
  to be passed through to the container (e.g.
  `--device=/dev/video0:/dev/video0`), so "verify" for a USB source can only
  ever report on whether that passthrough is already in place; the UI/API
  can't provision it. No special UX to distinguish "container config problem"
  from "bad input" — a failed USB verify just reports failure, same as RTSP.
- Credentials (RTSP username/password) live inside the `config` JSONB blob,
  not a dedicated column — so redacting them from list/detail API responses
  means stripping specific known keys out of the JSON at the API layer
  (rather than just excluding a column from a query), and they still
  shouldn't be logged in plaintext. **No encryption-at-rest** — redaction at
  the API layer is the decided mitigation, nothing further in Postgres
  itself.
- **`config` validation is a Zod schema keyed by `type`** — since the JSONB
  column itself has no structure Postgres can enforce, the API layer picks
  the right Zod schema (RTSP shape vs. USB shape) based on the row's `type`
  and validates the posted `config` against it before saving.
- **The seeded default webcam channel starts `enabled: false`** — it exists
  for local testing but isn't live by default; an admin has to explicitly
  turn it on.

## Monitoring profiles (person identity & images)

The second piece of the DB layer: who the system should watch for — people of
interest, not authorized/trusted people. Decided as two tables with a
1-to-many relationship, rather than one row per image or a single row with
multiple embedded images.

- **`MonitoringProfile`** — one row per watched person. Holds just the
  `name` and an `isTest` boolean flag (see below) — no other profile-level
  metadata for now (no notes, case reference, etc.; revisit only if a real
  need shows up). This is the entity `security-server-ui`'s add/edit/remove
  pages operate on, and the label surfaced when an alert fires (`"Alert:
<name> detected"`).
- **`isTest` separates calibration profiles from real watch-list profiles**:
  the live alert pipeline (Phase 3) only ever compares against
  `isTest: false` profiles' embeddings — test profiles are entirely excluded
  from that in-memory match set, not merely "matched but ignored." The
  "test match" calibration flow (see "Video feed sources" above) does the
  opposite: it only compares against `isTest: true` profiles. This keeps
  calibration data from ever being able to trigger a real `Alert` row, and
  keeps real watch-list data out of the calibration flow.
- **UI separation via tabs**: the `security-server-ui` profiles list page has
  two tabs — Test and Monitoring — filtering on `isTest` client-side of the
  same list view, rather than mixing both kinds of profile into one
  undifferentiated list or hiding test profiles away in a separate page
  entirely.
- **Test profiles don't count toward the <50-profile scale target**: since
  they're never loaded into the live monitoring service's match set (see
  above), they have no bearing on the in-memory matching performance the
  <50 target was about in the first place — that number is really a target
  for real/`isTest: false` profiles only, and test profiles are effectively
  unbounded/separate from it.
- **No restrictions for now on image count, size, or format per profile**:
  no cap on the number of `MonitoringProfileImage` rows a profile can have,
  no file-size limit on uploads, and no fixed allow-list of accepted image
  formats — whatever the image-decoding pipeline (YuNet/SFace's underlying
  decoder) can handle is accepted, rather than maintaining a separate format
  validation layer.
- **`MonitoringProfileImage`** — many rows per `MonitoringProfile` (FK
  relationship), each holding one enrollment image as a blob. The schema
  supports multiple images per person, but given images come from public/
  social-media sources rather than a controlled photo shoot, **a single image
  is the expected common case, not the exception** — multiple angles/
  expressions/lighting variants (which would otherwise help recognition
  accuracy, see "Known limitations" below) should be treated as a bonus when
  available, not a requirement the UI enforces. The schema still needs to
  allow adding/removing individual images without touching the profile
  itself, for whenever more photos of a person do turn up later.
- **One embedding per image, not aggregated**: each `MonitoringProfileImage`
  keeps its own 128-d SFace vector, computed once (via YuNet + SFace) at
  upload time, not recomputed from raw bytes on every restart. Matching
  compares an incoming face against every stored image-embedding (across all
  profiles) rather than one averaged vector per person — chosen over
  aggregation because averaging embeddings from photos with different
  angles/lighting risks blurring the signal, which matters more here given
  enrollment photos are uncontrolled social-media sources; the extra
  comparisons are negligible at this scale (well under a few hundred vectors
  total for <50 profiles).
- **Embedding column is `vector(128)` (pgvector), not a plain array/JSON** —
  even though matching runs in-memory for now, storing it as a real
  `vector` column means the schema is already in the shape a future move to
  DB-side matching would need, with no migration required later beyond
  possibly adding an index. This isn't new infrastructure work: both
  `docker-compose.development.yml` and `docker-compose.production.yml`
  already run `pgvector/pgvector:pg18` (not plain `postgres`), and
  `configs/postgres/init.sql` already runs `CREATE EXTENSION IF NOT EXISTS
vector SCHEMA security_server` against both the main and test databases —
  this was apparently anticipated before this plan existed.
  **What's still actual work**: `packages/security-server/prisma/schema.prisma`
  is currently a blank scaffold with no models and no `previewFeatures` at
  all. Using this column from Prisma will need
  `previewFeatures = ["postgresqlExtensions", "multiSchema"]` and the
  `security_server` schema declared on the datasource (since that's where
  `init.sql` put the extension, not `public`). Prisma also doesn't have
  first-class support for the `vector` type — it'll show up as
  `Unsupported("vector(128)")` in the schema, meaning reads/writes to this
  specific column go through `$queryRaw`/`$executeRaw` rather than the
  normal typed Prisma Client API.
- **Management UI**: `security-server-ui` gets pages to create/edit/remove
  `MonitoringProfile` rows (name), and within a profile, add/remove its
  `MonitoringProfileImage` rows (upload a photo → detect + align via YuNet,
  compute its SFace embedding, store it, delete a photo) — mirroring the
  create/verify pattern from the video feed sources section above, minus the
  "verify" step (there's nothing to "verify" about a stored image other than
  that a face is detectable in it, which the upload-time embedding
  computation already requires).
- **Single-face constraint**: uploaded photos are required to contain only
  the profile subject — no group shots. This is a hard reject, not something
  the app resolves for the admin: the upload flow runs YuNet and rejects the
  image outright if it detects zero faces or more than one, rather than
  prompting the admin to pick a bounding box out of several.
- **Enrollment image quality gate — guidelines + warn, don't block**: the
  upload page shows guidelines before the admin picks a file (clear, close-up,
  one person, decent resolution). After upload, YuNet runs immediately:
  - **Zero or multiple faces detected** → hard reject (per the single-face
    constraint above); the admin must pick a different photo.
  - **A face is detected but looks marginal** — smaller than roughly 80×80px
    in the source image, or below YuNet's detection-confidence threshold
    (configured moderately permissive, around 0.6–0.9, rather than stricter
    defaults tuned for clean studio photos) — the UI **warns** the admin
    ("this photo may produce a lower-quality match") and asks whether to
    proceed with it anyway or discard and try another, rather than blocking
    outright. Below roughly 40×40px it's a hard reject instead — the crop is
    unusably blurry once resized to SFace's fixed 112×112 input regardless of
    the warning.
  - No automated detection of sunglasses/filters/heavy occlusion — that would
    need its own attribute-classification model for something the admin
    already judges by looking at the photo they're choosing to upload.
    This mirrors the rest of the plan's general posture on source-photo
    quality: too strict and legitimate profiles can't be created from the only
    photo available; too loose and low-quality embeddings hurt runtime
    matching — so the system informs and lets the human operator decide,
    rather than picking one failure mode for them.
- Enrollment (Phase 1) is the consumer of this data — instead of decoding raw
  image bytes on every startup, it loads every `MonitoringProfileImage.embedding`
  (joined to its parent `MonitoringProfile` for the name) directly into
  memory.

## Alerts (detection history)

The third piece of the DB layer: a record of what happened, when, who, and
where — decided as a new **`Alert`** table.

- **Core columns**: `timestamp` (when the detection occurred),
  `monitoringProfileId` (FK → `MonitoringProfile` — who was detected), and
  `channelId` (FK → the video feed source table — which camera saw them; see
  the "Video feed sources" section above for that table's shape).
- **The two foreign keys behave differently on delete** — deliberately
  asymmetric: `channelId` is **no-cascade** (deleting a channel with alert
  history is blocked, per the "Video feed sources" section above), while
  `monitoringProfileId` is **cascade** — deleting a `MonitoringProfile` also
  deletes every `Alert` row pointing at it. Removing someone from the
  watch-list wipes their detection history along with them, rather than
  leaving orphaned alert rows or blocking the profile deletion.
- **This is a detection log, not a push notification** — inserting an
  `Alert` row is the one guaranteed side effect of Phase 3's alert pipeline.
  For now, the only way to see it is a new **Alerts page** in
  `security-server-ui` — a list of `Alert` rows (who, when, which channel),
  read by someone actively checking it. An external push-style channel
  (audio/SMS/webhook/email — open question below) is deferred, not built yet.
- Phase 3's `triggerAlertPipeline()` inserts an `Alert` row first, then hands
  off to whatever notification mechanism is chosen — the DB write shouldn't
  be blocked on or coupled to that delivery step succeeding.

## Open questions to resolve before/during implementation

1. **Push-style alert channel — deferred, not currently open**: for now, an
   Alerts page in `security-server-ui` (reading the `Alert` table) is the
   only way to see a detection; no audio alarm, SMS, webhook, or email is
   being built yet. Revisit only if/when passively checking a page stops
   being sufficient.
2. **USB device enumeration feasibility — deferred, left genuinely unknown
   for now**: the probe-first approach above assumes OpenCV/
   `@u4/opencv4nodejs` can enumerate connected camera devices on the host;
   this is OS-specific (v4l2/DirectShow/AVFoundation) and not guaranteed to
   be exposed by the binding — unlike the YuNet/SFace binding-coverage
   question, this one hasn't been checked yet, and deliberately isn't being
   checked now. Not blocking: initial testing runs against the seeded
   default webcam channel, which needs no enumeration. If it isn't
   available once real USB cameras are being added, device selection simply
   falls back to manual index/path entry as the normal path, not a rare
   fallback. Still open either way: for RTSP, a single full URL field vs.
   decomposed host/port/path/username/password for the parts that must stay
   manual.

## Known limitations to design around

- SFace embeddings are noticeably more robust to lighting/angle variation than
  LBPH would have been, which matters more here than in a controlled-photo
  scenario: enrollment images are whatever public photos exist, often a
  single one, so the recognition approach can't rely on curated multi-angle
  samples the way an ideal enrollment process would.
- Source photo quality is uncontrolled and will vary a lot — compression
  artifacts from repeated social-media re-encoding, low resolution, filters,
  partial occlusion, and outdated photos (someone's appearance may have
  changed since the photo was taken) are all realistic, and none of them are
  things the pipeline can fix; they set a ceiling on achievable accuracy that
  a better camera or algorithm can't fully compensate for.
- Sourcing biometric enrollment photos from public/social-media profiles of
  identifiable individuals is a distinct question from the recognition
  algorithm itself — worth confirming there's a clear legal/compliance basis
  for this (platform terms of service on scraping, applicable biometric-data
  or privacy regulations) before this goes into real use, independent of
  whether the technical approach works.
- **No automated sunglasses/filter detection** — considered and declined.
  Neither YuNet nor SFace expose face-attribute signals (they give a bounding
  box, a confidence score, and 5 landmarks — not "is this person wearing
  sunglasses"). A pixel-darkness heuristic around the eye landmarks would be
  unreliable (false positives from shadows/dark skin/low light, false
  negatives from lightly-tinted lenses), and a real attribute-classification
  model would be a genuinely new dependency (another `.onnx` model to
  source/bundle/tune, another inference pass per upload) — out of proportion
  to a case the existing size/confidence warning partially covers already as
  a side effect.
- No liveness detection in this plan — a printed photo or phone screen can
  spoof the matcher. Out of scope for the current use case but flag if this
  ever becomes an access-control (not just alerting) system.
- Embeddings are held in memory only; a restart (or an admin adding/removing
  a monitoring profile or one of its images) reloads them from Postgres. This
  is cheap and instant either way — unlike LBPH there's no training step at
  all, just a DB read — so no separate model-persistence layer is needed, the
  DB rows are the source of truth.
- YuNet/SFace model files are a new kind of asset this repo doesn't currently
  manage (not npm packages, not apk packages) — they need a clear home (e.g.
  committed under `packages/security-server` or fetched at build time) and a
  license check (both ship under the OpenCV Zoo project).
