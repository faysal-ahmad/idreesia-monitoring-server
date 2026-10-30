# Idreesia Security Server

A watch-list face recognition system for RTSP security cameras. It watches the camera feeds for people on a watch list and raises an alert, with a snapshot, when one of them is seen. It works alongside the Idreesia ERP: channels (cameras) and monitoring profiles (people) can be edited in either, and every alert is delivered to the ERP.

## What it does

- **Watches cameras.** Each enabled channel's stream is read continuously and sampled at a configurable rate. Faces are detected (YuNet), checked for size and quality, embedded (SFace), and compared against the watch list.
- **Raises alerts.** A match creates an alert: who was seen, on which camera, when, how confident the match was, and a full-frame snapshot with the face marked. Alerts appear live on the Alerts page and are sent to the ERP.
- **Manages the watch list.** Monitoring profiles hold one or more photos of each person. Photos are checked when uploaded: exactly one face, large enough, clear enough. Test profiles let admins calibrate each camera's match threshold without touching the real watch list.
- **Uses the hardware fully.** Recognition is spread across several worker processes, and the face models run on an NVIDIA GPU when one is available. A Usage page shows how loaded the server is and what each camera costs.

It's built for a small deployment: one server, close-up cameras at entrances, and fewer than 50 people on the watch list. It alerts; it isn't access control.

## Documentation

| Document                                                 | Covers                                                                                                                                                                                                    |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [docs/face-recognition.md](docs/face-recognition.md)     | The system as a whole: architecture, channels, monitoring profiles and enrollment checks, matching and alerts, ERP sync, configuration, known limitations, and the reasons behind the main design choices |
| [docs/inference-pipeline.md](docs/inference-pipeline.md) | What happens to each camera frame, how cameras are spread across processes, GPU acceleration, performance settings, and how to read the Usage page and tune the server                                    |

## Repository layout

An [Nx](https://nx.dev) workspace with two packages:

| Package                       | What it is                                                                                                                                                                |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/security-server`    | The backend: NestJS, Prisma (PostgreSQL with pgvector), OpenCV through `@u4/opencv4nodejs`. Runs the API, the camera ingestion processes, alert storage and the ERP sync. |
| `packages/security-server-ui` | The admin and alerts web app: Alerts, Channels, Profiles, Usage and Configuration pages.                                                                                  |

Supporting services, run through Docker Compose:

- **PostgreSQL with pgvector**: channels, profiles, embeddings, alerts and usage stats.
- **go2rtc**: pulls each camera once and re-streams it to the recognition processes and to the browser's live view.

## Local development

The development stack runs everything in Docker, with the repo bind-mounted and hot reloading:

```sh
yarn docker:development:up       # build and start
yarn docker:development:down     # stop
yarn docker:development:destroy  # stop and delete the volumes (database included)
```

- The UI is at <http://localhost:4200>. The admin password in development is `admin`; the Alerts page needs no password.
- The server expects the Idreesia ERP's development stack on the host, at port 3000, for the ERP sync. Without it, the sync logs errors and everything else still works.
- Development runs the face models on the CPU.
- To test with a laptop webcam on macOS, `./start-webcam-rtsp.sh` publishes the FaceTime camera as `rtsp://localhost:8554/webcam` through mediamtx and FFmpeg. Point a channel at it from the container as host `host.docker.internal`, port 8554, path `webcam`. `./stop-webcam-rtsp.sh` stops it. This needs `mediamtx` and `ffmpeg` installed with Homebrew.
- After changing `packages/security-server/webpack.config.js`, restart the server container (`yarn docker:development:restart`). Its `webpack --watch` reads the config only at startup.

Tasks run through Nx, for example:

```sh
npx nx run @idreesia/security-server:build
npx nx run <project-name>:<target>
```

## Versioning and releasing

Releases run from `.github/workflows/release.yml`; the version logic lives in `scripts/resolve-release-version.mjs`.

- **PR into `develop`**: label it `major`, `minor` or `patch`. When it merges, the version in the package.json files is bumped and committed as `chore(release): X.Y.Z for PR #N [skip ci]`.
- **PR from `develop` into `master`**: when it merges, the release is tagged `vX.Y.Z`. Both production images are then built (linux/amd64) and pushed to GHCR with the tags `X.Y.Z`, `X.Y`, `X` and `latest`:
  - `ghcr.io/faysal-ahmad/idreesia-security-server/security-server`
  - `ghcr.io/faysal-ahmad/idreesia-security-server/security-server-ui`

## Deploying

`docker-compose.production.yml` runs the published `latest` images. The `security-server` image is built from `packages/security-server/Dockerfile.production` with a CUDA-enabled OpenCV, and the compose file passes the host's NVIDIA GPUs through to it. The host needs:

- an NVIDIA driver supporting CUDA 12 (driver 525 or newer)
- the [NVIDIA Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html)
- `OPENCV_DNN_TARGET=cuda` in `.env`, so the face models run on the GPU (without it they stay on the CPU)

Both production compose files read their settings from a `.env` file next to them. Copy `.env.sample` to `.env` and fill in the values. `.env.sample` describes every setting, including `INGESTION_PROCESSES` and `UV_THREADPOOL_SIZE`; see [docs/inference-pipeline.md](docs/inference-pipeline.md#configuration) for how to size them.

The packages are public, so the host can pull them without logging in:

```sh
yarn docker:production:pull
yarn docker:production:up
```

To build CPU-only images locally instead (for example on a machine without a GPU), use `docker-compose.production-local.yml`:

```sh
yarn docker:production-local:build
yarn docker:production-local:up
```

### Container logs

Both production compose files send every container's logs to the host's systemd journal (`journald` log driver), so they outlive the containers. Bound their disk use by capping the journal at 2 GB once on the host (this applies to the whole journal, not just Docker; once the cap is reached, journald deletes the oldest entries first):

```sh
sudo mkdir -p /etc/systemd/journald.conf.d
printf '[Journal]\nStorage=persistent\nSystemMaxUse=2G\n' | sudo tee /etc/systemd/journald.conf.d/retention.conf
sudo systemctl restart systemd-journald
```

Read them with `journalctl` (add `-f` to follow, `--since today` to narrow):

```sh
journalctl CONTAINER_NAME=idreesia-security-server-security-server-1
```

Lines from the camera ingestion processes are prefixed `[Ingestion <n>]`.

Containers need recreating once (`yarn docker:production:up`) to pick up the new log driver. `docker logs` still works for containers using it.
