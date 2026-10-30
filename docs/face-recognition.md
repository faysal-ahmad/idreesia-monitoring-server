# Face Recognition

What the security server does, how it's put together, and the design decisions behind it. For what happens to each camera frame and how the work is spread across processes, see [inference-pipeline.md](inference-pipeline.md).

## Purpose

The security server is a **watch-list alerting system**, not access control. A monitoring profile is a person of interest, and the system raises an alert when one of them is _detected_ on a camera. A face that doesn't match anyone is ignored.

Enrollment photos come from whatever public photos of the person can be found, often social media, not a controlled photo shoot. That shapes a lot of the design:

- one photo per person is the normal case;
- resolution, compression, angle and lighting vary widely;
- the system informs the admin about poor photos rather than refusing them.

### Scope

| Aspect          | Choice                                                                                                   |
| --------------- | -------------------------------------------------------------------------------------------------------- |
| Deployment      | One local server (production: Ryzen 9 9900X, RTX 5060 Ti 16 GB), in Docker                               |
| Cameras         | RTSP cameras, framed close-up (doorways, entrances)                                                      |
| Watch list      | Under 50 people                                                                                          |
| Runtime         | Node.js (NestJS), OpenCV through `@u4/opencv4nodejs`                                                     |
| Detection       | YuNet (ONNX)                                                                                             |
| Recognition     | SFace (ONNX), 128-dimension embeddings compared by cosine similarity                                     |
| Storage         | PostgreSQL with pgvector, through Prisma                                                                 |
| Source of truth | Shared with the ERP: channels and profiles are edited in either place and kept in step by a two-way sync |

## Architecture

```
 RTSP cameras ──▶ go2rtc ──re-stream──▶ ingestion processes ──▶ main process ──▶ PostgreSQL
                    │                   (detect, embed, match)   (API, alerts,   alert images on disk
                    │                                             ERP sync)       │
                    ▼                                                 ▲           ▼
              browser live view                         security-server-ui     ERP (channels,
                                                                               profiles, alerts)
```

- **go2rtc** (`MediaServerService`) pulls each enabled camera once and re-streams it, both to the recognition loops and to the browser's live view. The server re-syncs go2rtc's streams with the enabled channels periodically and on demand, so a go2rtc restart recovers on its own.
- **Ingestion processes** read the re-streams and run recognition. See [inference-pipeline.md](inference-pipeline.md).
- **The main process** serves the API used by `security-server-ui`, stores alerts, handles profile enrollment, and runs the ERP sync.
- **security-server-ui** has the Alerts, Channels, Profiles, Usage and Configuration pages. The Alerts page, its images and channel health are public; everything else needs the admin password (`ADMIN_PASSWORD`).

### Why these libraries

- **OpenCV through `@u4/opencv4nodejs`**: the original `opencv4nodejs` is unmaintained; `@u4/opencv4nodejs` is the maintained fork. It doesn't wrap OpenCV's `FaceDetectorYN` or `FaceRecognizerSF`, so both models run through the generic `cv.dnn` module (`readNetFromONNX`, `blobFromImage`, `forward`). YuNet's raw anchor output is decoded by hand, ported from OpenCV's `FaceDetectorYNImpl::postProcess`; `cv.NMSBoxes` handles non-maximum suppression.
- **YuNet** rather than a Haar cascade: far more robust to the angles and lighting of a real doorway camera, and it gives the five landmarks needed to align faces.
- **SFace** rather than LBPH: embeddings are much more robust to lighting and angle, and there's no training step. Enrolling a person is just computing an embedding.
- **Cosine similarity** rather than L2 distance: a bounded "higher means more similar" score is easier to explain to an admin calibrating a threshold.

Both models come from the OpenCV Zoo and are committed under `packages/security-server/models/` with their licences.

## Channels (video feed sources)

A channel is one RTSP camera (`VideoFeedSource`).

- **Connection details** (host, port, path, username, password) live in a JSONB `config` column, validated by `RtspConfigSchema`. Credentials are redacted from API responses and never logged; they aren't encrypted at rest.
- **Per-channel settings:**
  - `recognitionFps` (default 5): frames analysed per second.
  - `minFaceSizePx` (default 96): smallest face, in native pixels, that is matched.
  - `minFaceQuality` (default 40): lowest quality score that is matched.
  - `similarityThreshold` (default 0.36, SFace's reference value for cosine similarity): the score needed for a match.
  - For each of these, null means use the default.
- **Verify:** before saving, the UI can check that a camera is reachable. The server opens the stream and reads one frame. It's a reachability check only.
- **Disabling vs deleting:** a channel with alert history can't be deleted, only disabled, so every alert can still say which camera it came from. The `Alert` foreign key is `Restrict`, and the API reports a clear error. A channel whose camera stays unreachable for about 6 minutes of retries is disabled automatically.
- **Live view and frame tools** on the channels page:
  - The browser plays the go2rtc re-stream directly.
  - **Capture** sends the current live-view frame to the server (`analyze-frame`), which shows the size and quality score of every face in it, as the live pipeline measures them.
  - **Test match** captures a frame on the server and compares the strongest face against the **test profiles only**. The admin uses the resulting scores to choose the channel's `similarityThreshold` by observing real scores, not by guessing a number.

## Monitoring profiles

A `MonitoringProfile` is a person: a name and an `isTest` flag. It has one or more `MonitoringProfileImage` rows.

- **Test profiles** (`isTest: true`) exist for calibration. Test match only compares against them, and they're left out of the live match set unless the **Include Test Profiles in Alerts** setting is on. That setting exists for end-to-end testing: walk past a camera and see the alert without enrolling someone on the real watch list. The Profiles page shows test and monitoring profiles on separate tabs.
- **One embedding per photo, not averaged per person.** Each image keeps its own SFace embedding in a pgvector `vector(128)` column. A face is compared against every stored embedding. Averaging photos taken at different angles and in different light would blur the signal, and the extra comparisons cost nothing at this scale.
- **Embedding versions.** Each embedding records the pipeline version that produced it (`EMBEDDING_MODEL_VERSION`). Embeddings from different versions aren't comparable, so `EmbeddingBackfillService` recomputes any stored under an older version, from the stored image, at startup.
- **Default image:** an optional thumbnail for the list. It plays no part in matching.

### Enrollment checks

When a photo is uploaded, the server runs detection on it at once:

| Result                                                  | Outcome                                                                           |
| ------------------------------------------------------- | --------------------------------------------------------------------------------- |
| No face, or more than one face                          | **Rejected.** Photos must show only the profile subject; the admin picks another. |
| Face shorter side under 40 px                           | **Rejected.** Too blurry once scaled to SFace's 112×112 input.                    |
| Face under 80 px, or detector score between 0.6 and 0.9 | **Warning.** The admin chooses whether to keep it.                                |
| Otherwise                                               | Saved, with its embedding.                                                        |

There's no limit on the number of photos, file size or format: anything OpenCV can decode is accepted. Photos synced from the ERP were already checked there, so the server accepts any face it can find in them (detector score 0.3 or above). A synced photo with no detectable face is kept, so the photo set still matches the ERP's, but it takes no part in matching.

There's deliberately no automatic detection of sunglasses, filters or occlusion. Neither model provides face attributes, and a heuristic would be unreliable. The admin can judge this by looking at the photo they've chosen.

## Matching and alerts

- **The watch list is held in memory.** The main process loads every usable embedding (`FaceMatchCacheService`) at startup, after ERP syncs and whenever profiles or settings change, then sends it to every ingestion process.
  - Comparing a face against about 150 embeddings by brute force takes microseconds, negligible next to detection and embedding. Querying pgvector per face would only add a database round trip.
  - This is worth revisiting only at tens of thousands of embeddings: around 10,000 adds 10–20 ms per face, and 100,000 adds 100–200 ms. The `vector(128)` column already has the shape that database-side matching would need.
- **A match** is the best score at or above the channel's threshold.
- **Cooldown:** after an alert for a profile on a channel, further matches of that profile on that channel are ignored for 60 s. Without it, one person standing at a door would create an alert for every analysed frame.
- **An alert** (`Alert`) records the time, profile, channel, similarity score, face size and quality, and a JPEG of the full frame with the matched face boxed (long side capped at 1920 px). The JPEG is stored on disk under `ALERT_IMAGES_DIR`, not in the database.
- **Delivery:**
  - The Alerts page updates live.
  - The ERP receives each alert as soon as it's raised. If the ERP is unreachable, the alert stays `PENDING` and is retried every **ERP Alert Retry Interval** minutes.
  - There's no push notification (sound, SMS, email) yet. Someone has to be watching the Alerts page or the ERP.
- **Retention and deletion:** alerts older than **Alerts Retention (days)** (default 7) are deleted. Deleting a profile deletes its alerts too (`Cascade`): removing someone from the watch list removes their detection history.

## ERP sync

Channels and profiles, including photos and the default image, are edited in both the ERP and this server. `ErpSyncService` keeps them in step every **ERP Sync Interval** minutes (default 5), and on demand from the Sync buttons:

1. It pulls what changed in the ERP since the last run and applies it. Where a record also changed here, this server's version wins.
2. It pushes everything that changed here.

Each side stores the other's id as `externalId`. A deleted record is kept, hidden, with `deletedAt` set, until the ERP has been told about it.

The sync runs only when `ERP_URL`, `ERP_USERNAME` and `ERP_PASSWORD` are all set.

## Configuration

Admin-editable settings live in the `Configuration` table, one row per key, defined with defaults and validation in `configuration/configuration.schema.ts`. Adding a setting means adding an entry there, not a migration.

| Setting                            | Default |
| ---------------------------------- | ------- |
| Alerts Retention (days)            | 7       |
| Include Test Profiles in Alerts    | off     |
| ERP Sync Interval (minutes)        | 5       |
| ERP Alert Retry Interval (minutes) | 1       |

Deployment settings (database, admin password, ERP connection, GPU, process count) are environment variables; see `.env.sample`.

## Known limitations

- **Enrollment photo quality sets the ceiling.** Compression from repeated re-sharing, low resolution, filters, occlusion and outdated photos can't be fixed by the pipeline, and a single photo per person gives little to match against.
- **No liveness detection.** A printed photo or a phone screen can match. That's acceptable for alerting, but not if this ever becomes access control.
- **Legal basis.** Sourcing biometric enrollment photos from public profiles of identifiable people needs a clear legal and compliance basis (platform terms, privacy and biometric-data regulation), separate from whether the technology works.
- **No push notifications** yet (see above).
