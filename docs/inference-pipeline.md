# Inference Pipeline

How the security server turns camera streams into alerts: what happens to each frame, how the work is spread across processes to use the CPU and GPU, how to read the usage page, and the constraints that shaped the design.

## Overview

```
 cameras ──RTSP──▶ go2rtc ──re-stream (RTSP)──▶ ingestion processes (N) ──IPC──▶ main process
                     │                           read · detect · embed ·        DB · API · alerts ·
                     │                           match · snapshot               coordination
                     └──WebSocket (MSE)──▶ browser (channels page live view)
```

- **go2rtc** pulls each enabled camera once and re-streams it. Nothing in the server connects to a camera directly, except the add/edit form's reachability check.
- **Ingestion processes** (default 4) each own a share of the channels. For each of its channels a process reads the stream and runs recognition on sampled frames. When a face matches, it encodes the snapshot and sends the alert to the main process.
- **The main process** is the Nest app: the HTTP API, the database, alert storage and the Alerts page's live stream, profile enrollment, and the channels page's frame tools. It decides which process reads which channel and collects health and stats from all of them.

## Per-frame pipeline

Each channel has one read loop, in `process/channel-loop.service.ts`:

1. **Read.** `VideoCapture.readAsync()` reads every frame from the re-stream so the stream stays near-live and its buffer drains. The read runs on a libuv thread, so it doesn't block the process.
2. **Sample.** A frame is analysed only if `1 / recognitionFps` seconds have passed since the last analysed frame _and_ the previous frame has finished. Other frames are released straight away and counted as skipped:
   - **`fps`:** the frame wasn't due.
   - **`busy`:** it was due, but the previous frame was still being processed. This means recognition isn't keeping up.
3. **Downscale for detection.** The frame is scaled by `detectionScaleFor(minFaceSize)` (`recognition/face-gate.ts`). YuNet finds faces reliably from about 32 px, so with the default minimum face size of 96 px, detection runs at a third of the resolution. Everything after detection uses the full frame.
4. **Detect (YuNet).** `FaceDetectionService.detect(..., allowFallback = false)` gives face boxes, scores and five landmarks, mapped back to full-frame coordinates.
5. **Size gate.** Faces smaller than the channel's `minFaceSizePx` (default 96) are skipped before any more work is done.
6. **Align.** A similarity transform of the five landmarks produces a 112×112 crop (`FaceRecognitionService.align`).
7. **Quality gate.** `FaceQualityService.assess` scores size, detector confidence, sharpness, exposure and pose from 0 to 100. Faces below the channel's `minFaceQuality` (default 40) are skipped.
8. **Embed (SFace).** A 128-dimension embedding (`FaceRecognitionService.embed`).
9. **Match.** Cosine similarity against the watch list held in this process (`process/process-match-cache.ts`). The best match at or above the channel's `similarityThreshold` (default 0.36) wins.
10. **Alert.** A cooldown of 60 s per channel and profile suppresses repeats. If the alert isn't suppressed, the matched face is boxed on a copy of the full frame, encoded as JPEG (long side capped at 1920 px), and sent to the main process. There, `AlertPipelineService` saves it with `AlertService.create`, which stores the image and the row and pushes the alert to the Alerts page.

Detection and embedding time is recorded per channel (`ChannelStatsRecorder.inference`). This is the "inference lane" time shown on the usage page.

### Models

| Model              | File                                         | Input                            | Output                                                         |
| ------------------ | -------------------------------------------- | -------------------------------- | -------------------------------------------------------------- |
| YuNet (detector)   | `models/face_detection_yunet_2023mar.onnx`   | Frame padded to a multiple of 32 | Per-anchor scores, boxes and landmarks at strides 8, 16 and 32 |
| SFace (recogniser) | `models/face_recognition_sface_2021dec.onnx` | 112×112 aligned crop             | 128-dimension embedding                                        |

Both run through OpenCV DNN, on the GPU when `OPENCV_DNN_TARGET=cuda` (see [GPU acceleration](#gpu-acceleration)). For why these models were chosen, and for the rest of the system, see [face-recognition.md](face-recognition.md).

## Running in parallel: the process model

### Why processes, not threads

OpenCV DNN calls are synchronous native calls. In a single Node process every camera's detect and embed calls queue behind each other on the one JavaScript thread, which is the single "inference lane". In production that lane reached 97% busy with 10 cameras while the GPU sat at 6%. The GPU had capacity, but there was only one thread giving it work.

Worker threads don't fix this. `@u4/opencv4nodejs` keeps its JavaScript class templates (`Mat`, `Net`, …) in process-wide static variables, so a second thread that loads the binding overwrites them:

- After a worker thread loads OpenCV, Mats returned on the main thread are broken. `resize()` returns a Mat whose `rows` is `undefined`.
- Several workers loading models at the same time crash the process (`Cannot create a handle without a HandleScope` in `readNetFromONNX`).

**OpenCV can only be used from one JavaScript thread per process.** Parallelism therefore comes from separate processes, each with its own copy of the binding, the models and, on CUDA, its own GPU context.

### How the work is split

The cameras are spread across the processes, rather than frames being sent to inference workers. Each ingestion process reads, decodes and runs recognition for its own channels, so:

- full frames never cross a process boundary. Only health reports, stats and alerts with their JPEG snapshot do;
- stream decoding, which is CPU work done by OpenCV's FFmpeg backend, is spread across processes too, not only inference;
- a native crash, which can't be caught in JavaScript, takes down one process's channels instead of the whole server.

Each process is one inference lane. With `INGESTION_PROCESSES=4`, four frames can be in detection or embedding at once, from four different groups of cameras.

### Channel assignment

`IngestionProcessPoolService.setDesiredChannels` runs on every reconcile: at startup, after the ERP sync, and on `/system/reload`, which the UI calls after any channel change.

- **New channel:** goes to the process with the lowest load, where load is the sum of `recognitionFps × frame width × frame height` over its channels. Frame size comes from health reports and is taken as 1920×1080 until a channel's first frame.
- **Existing channel:** stays where it is. It gets the fresh channel record. If the connection details changed, the process reconnects; any other change, such as name, FPS or thresholds, applies in place.
- **Removed or disabled channel:** stopped and unassigned.

Assignments aren't rebalanced afterwards. If load becomes uneven, for example after FPS changes, a server restart redistributes the channels.

### Messages between the processes

Defined in `src/ingestion/process/ingestion-protocol.ts`. They're sent over Node IPC with `serialization: 'advanced'`, so Dates and Buffers survive.

| Direction      | Message             | Purpose                                                                                  |
| -------------- | ------------------- | ---------------------------------------------------------------------------------------- |
| main → process | `setChannels`       | The full set of channels the process should read, with their go2rtc re-stream URLs       |
| main → process | `setMatchCache`     | The watch list's embeddings; sent at startup and whenever profiles or settings change    |
| main → process | `collectStats`      | Return and reset this stats window                                                       |
| main → process | `stop`              | Shut down cleanly                                                                        |
| process → main | `ready`             | Models loaded. Main then sends the match cache and channels; nothing is sent before this |
| process → main | `health`            | Every 2 s: last frame time, reconnect attempts and frame size per channel                |
| process → main | `alert`             | A match that passed the cooldown, with its JPEG snapshot                                 |
| process → main | `unreachable`       | The process gave up on a channel after 10 failed reconnects; main disables it in the DB  |
| process → main | `requestStreamSync` | A re-stream was missing (go2rtc probably restarted); main re-syncs go2rtc                |
| process → main | `stats`             | The reply to `collectStats`                                                              |

### Lifecycle and failure handling

- **Startup:** main forks the processes from `dist/ingestion-process.js`, a second webpack entry built next to `main.js`. They inherit the environment (`OPENCV_DNN_TARGET`, `UV_THREADPOOL_SIZE`, …) but not `--watch`.
- **Crash:** the pool logs `Ingestion process <n> exited`, waits 5 s, starts a new one, and sends it the same channels and watch list. Those channels show `offline` meanwhile; every other channel keeps running.
- **Main process goes away** (crash, deploy, or a `node --watch` restart in development): each ingestion process exits on IPC `disconnect`, so no orphans are left reading cameras.
- **Shutdown:** main sends `stop` and waits up to 5 s, then kills the process.
- **Unreachable camera:** after 10 failed reconnects with backoff (about 6 minutes), the process stops the loop and sends `unreachable`. Main sets the channel's `enabled` to false, which syncs to the ERP like any other change, and removes the go2rtc stream.
- **Logs:** lines from an ingestion process are prefixed `[Ingestion <n>]`.

### What stays in the main process

The main process still loads both models, for work that is occasional and driven by people:

- profile photo enrollment and the embedding backfill;
- `analyze-frame` on the channels page, where the browser sends a frame captured from the live view and every face in it is rated and matched.

These are synchronous OpenCV calls. The live view on the channels page doesn't involve the server: the browser plays the go2rtc re-stream directly.

## Performance details

### One detector net per input shape

An OpenCV DNN net set up for one input shape is set up again from scratch when it gets a different shape. On the CUDA backend that means rebuilding cuDNN descriptors and buffers, which costs far more than the inference itself. Cameras of different resolutions sharing one net caused this on almost every frame.

`FaceDetectionService` therefore keeps one YuNet net per padded input shape for live frames, up to 16, dropping the least recently used. Profile photos come in every size, so they share a single separate net. SFace always takes 112×112, so one net is enough.

### Reading YuNet's outputs

YuNet's outputs are 3-D float Mats (`[1, anchors, n]`). The binding's `getData()` only accepts 2-D Mats, so `floatData()` reads them through `flattenFloat(anchors, n)`, a 2-D view of the same memory that copies nothing. It then indexes the returned bytes as a `Float32Array`, and box and landmark values are only read for anchors that pass the score threshold. The previous `getDataAsArray()` built nested JavaScript arrays for every anchor on every frame.

### Releasing Mats

Every Mat created per frame is released explicitly. If they're left to the garbage collector, the binding frees each native buffer from a GC finalizer. At this rate of Mats that ends in a V8 fatal error (`Isolate::AdjustAmountOfExternalAllocatedMemory`) that kills the process. Skipped frames are released at once for the same reason.

## GPU acceleration

Without a GPU, YuNet and SFace run on the CPU: in production, 9 channels at 2 fps used 6–7 of the 24 CPU threads while the RTX 5060 Ti sat idle. Three things are needed to run the models on the GPU, and each is set up:

1. **OpenCV built with CUDA.** Debian's packaged OpenCV has no CUDA, so `packages/security-server/Dockerfile.production` builds OpenCV 4.10.0 from source with `WITH_CUDA`, `OPENCV_DNN_CUDA` and cuDNN, on the `nvidia/cuda:12.6.3-cudnn` images. The build stage uses the `-devel` image and the runtime stage the `-runtime` image, with Node installed in both. `@u4/opencv4nodejs` is compiled against it (`OPENCV4NODEJS_DISABLE_AUTOBUILD=1`, `OPENCV_INCLUDE_DIR`, `OPENCV_LIB_DIR`), and the build fails if OpenCV doesn't report CUDA and cuDNN. FFmpeg stays enabled for `VideoCapture`.
2. **The CUDA backend requested.** `recognition/dnn-target.ts` calls `setPreferableBackend(DNN_BACKEND_CUDA)` and `setPreferableTarget(DNN_TARGET_CUDA)` on every net when `OPENCV_DNN_TARGET=cuda`, and logs "YuNet/SFace set to run on CUDA".
3. **The GPU visible in the container.** `docker-compose.production.yml` reserves the host's NVIDIA GPUs (`driver: nvidia`, `count: all`). The host needs an NVIDIA driver supporting CUDA 12 (525 or newer) and the NVIDIA Container Toolkit.

**Rollback:** unset `OPENCV_DNN_TARGET` and the models run on the CPU, with no image rebuild. The CPU-only image (`Dockerfile.production-local`, `docker-compose.production-local.yml`) is kept for machines without a GPU. The development container is CPU-only.

**Caveats:**

- **Architecture.** The RTX 5060 Ti is Blackwell (compute capability 12.0). The image compiles kernels ahead of time for 6.1, 7.5, 8.6 and 8.9 and includes 8.9 PTX, so on the 5060 Ti the kernels are JIT-compiled from PTX at startup. This loads and runs in production, but it hasn't been compared against a native `12.0` build, which needs CUDA 12.8 or later.
- **Silent fallback.** If CUDA can't be used, OpenCV logs a warning and falls back to the CPU, per net or even per layer. The startup log line states the backend that was _requested_, not the one in use. Check that GPU memory is in use (about 380 MB per process), and compare detection times on the usage page.
- **Startup warning.** OpenCV 4.10 logs a harmless cuDNN version-check warning ("90.5 vs 9.5") at startup.
- **One CUDA context per process.** The main process and every ingestion process each load the models, so each holds its own CUDA context and copies of the nets on the GPU.

**Alternative not taken:** onnxruntime-node with its CUDA execution provider. Both models are already ONNX, so it would avoid the OpenCV build, but the pre-processing, decoding and NMS would all have to be rewritten against ONNX Runtime tensors, and Blackwell support in its CUDA build would need verifying.

## Configuration

| Setting                       | Default     | Notes                                                                                                                                                                                                             |
| ----------------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `INGESTION_PROCESSES`         | 4           | Number of ingestion processes, which is the number of inference lanes. Each costs a Node process with its own models, plus a CUDA context of a few hundred MB on GPU servers.                                     |
| `OPENCV_DNN_TARGET`           | unset (CPU) | `cuda` runs both models on the GPU; see [GPU acceleration](#gpu-acceleration).                                                                                                                                    |
| `UV_THREADPOOL_SIZE`          | 4 (Node)    | Per process. Each channel's pending `readAsync` holds one libuv thread until its next frame arrives, so this must be at least the number of channels in the busiest process, plus a few. 16 is set in production. |
| Channel `recognitionFps`      | 5           | Frames analysed per second for that channel.                                                                                                                                                                      |
| Channel `minFaceSizePx`       | 96          | Also sets how far frames are downscaled for detection, so a larger minimum makes detection cheaper.                                                                                                               |
| Channel `minFaceQuality`      | 40          | Quality gate before embedding.                                                                                                                                                                                    |
| Channel `similarityThreshold` | 0.36        | Cosine similarity needed for a match.                                                                                                                                                                             |
| `STATS_INTERVAL_SECONDS`      | 60          | Usage stats window; 0 turns collection off.                                                                                                                                                                       |

## Reading the usage page

Each window, every ingestion process reports per-channel counters, its CPU time and its event-loop lag, and the main process writes one `ServerStats` row and one `ChannelStats` row per channel.

- **Inference lane % busy** is the **busiest** process's detect and embed time as a share of the window. Frames start being skipped as soon as any one lane fills, so the busiest lane is the one that matters. A low value means there's room for more cameras or a higher FPS.
- **Busy skips** (`skippedBusy`, busy-skip %) are frames that were due but dropped because the channel's previous frame was still being processed. Close to 0 is healthy.
- **Inference share %** per channel is that channel's share of its own process's lane. Use it to spot expensive cameras: high resolution, a small minimum face size, or busy scenes.
- **Milliseconds per analysed frame** for a channel is about `inferenceSharePct × 10 / processedFps`.
- **Process CPU** is the main process plus all ingestion processes, as a percentage of one core. The page shows it against the core count.
- **Event-loop lag** is the worst across all processes. A lagging ingestion process delays its channels' frames.
- **GPU utilisation and memory** come from `nvidia-smi`. Utilisation stays low while the lanes still have room; it rises as more lanes are busy at once.

### Tuning

| What you see                                             | What to try                                                                                                                                                |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Lane near 100%, busy skips rising, CPU and GPU have room | Raise `INGESTION_PROCESSES`. Restart to redistribute existing channels.                                                                                    |
| Lane high, CPU near the core count                       | CPU-bound: lower `recognitionFps`, raise `minFaceSizePx` on cameras where faces appear large, or move stream decoding to the GPU (NVDEC, not implemented). |
| One channel with a large inference share                 | Check its resolution and `minFaceSizePx`; consider a lower FPS for it.                                                                                     |
| Busy skips on one channel, lane low                      | That channel's frames are slow on their own (many faces per frame). Check its faces per frame and embed times.                                             |

## Code map

| Path (under `packages/security-server/src`)   | Role                                                                                                  |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `ingestion/video-ingestion.service.ts`        | Main: which channels run (reconcile), channel health, disabling unreachable channels                  |
| `ingestion/ingestion-process-pool.service.ts` | Main: forks and supervises the ingestion processes, assigns channels, routes messages, collects stats |
| `ingestion/alert-pipeline.service.ts`         | Main: saves alerts raised by the ingestion processes                                                  |
| `ingestion/face-match-cache.service.ts`       | Main: loads the watch list and sends it to the processes                                              |
| `ingestion/usage-stats.service.ts`            | Main: collects each window's stats from all processes and writes them                                 |
| `ingestion/channel-stats-recorder.ts`         | Per-channel stats counters, used inside the ingestion processes                                       |
| `ingestion/process/ingestion-process.main.ts` | Ingestion process entry point: startup, IPC handling, stats replies                                   |
| `ingestion/process/channel-loop.service.ts`   | Per-channel read loops, reconnects, frame sampling, health reports                                    |
| `ingestion/process/frame-pipeline.service.ts` | Detect, gates, embed, match, cooldown, snapshot                                                       |
| `ingestion/process/process-match-cache.ts`    | The process's copy of the watch list and cosine matching                                              |
| `ingestion/process/ingestion-protocol.ts`     | IPC message types                                                                                     |
| `recognition/face-detection.service.ts`       | YuNet: per-shape nets, decoding, NMS                                                                  |
| `recognition/face-recognition.service.ts`     | SFace: alignment, embedding, cosine similarity                                                        |
| `recognition/face-quality.service.ts`         | Quality score                                                                                         |
| `recognition/face-gate.ts`                    | Size and quality defaults, detection downscale                                                        |
| `recognition/dnn-target.ts`                   | CUDA backend selection                                                                                |
