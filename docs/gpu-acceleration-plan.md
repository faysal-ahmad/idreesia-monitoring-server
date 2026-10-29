# GPU Acceleration Plan — YuNet / SFace Inference

## Problem

Face detection (YuNet) and embedding (SFace) run on the CPU. With 9 channels at 2 fps
recognition (~18 detection passes/s) the `security-server` container uses ~600–670% CPU
(6–7 of 24 cores) while the host's RTX 5060 Ti sits at 0% / 24 MiB. The current load is
sustainable; the goal is headroom for more cameras / higher fps and a lighter CPU footprint.

## Why the GPU is not used today

Three independent blockers, each sufficient on its own:

1. **OpenCV has no CUDA.** Both Dockerfiles install Debian bookworm's `libopencv-dev`
   (4.6.0), built without CUDA. `cv::dnn` can only run on CPU.
2. **No GPU backend requested.** `face-detection.service.ts` and
   `face-recognition.service.ts` call `cv.readNetFromONNX(...)` only — no
   `setPreferableBackend` / `setPreferableTarget`.
3. **Container can't see the GPU.** `docker-compose.production.yml` has no
   `deploy.resources.reservations.devices` / `runtime: nvidia`; `/dev/nvidia*` is absent in the
   container. (The host already has the `nvidia` Docker runtime installed.)

## Step 0 — Measure first (prerequisite)

There are no per-frame metrics today, so we can't quantify the benefit. Before any GPU work,
add per-channel periodic stats logging (frames read / processed / dropped, mean detect and
embed time). Record a CPU baseline to compare against.

## Options

### Option A — OpenCV built with CUDA (recommended if we pursue this)

Keeps the existing `cv.dnn` code and `@u4/opencv4nodejs` bindings; the code change is two
lines per service.

- Build OpenCV 4.x from source with `WITH_CUDA=ON`, `OPENCV_DNN_CUDA=ON`, `WITH_CUDNN=ON`,
  `OPENCV_EXTRA_MODULES_PATH` (contrib), and `CUDA_ARCH_BIN=12.0`.
- The RTX 5060 Ti is Blackwell (compute capability 12.0): requires **CUDA >= 12.8** and an
  OpenCV release that supports that architecture. Verify the chosen OpenCV version's CUDA
  compatibility before committing to it.
- Build stage uses an `nvidia/cuda:<ver>-cudnn-devel-*` image; runtime stage uses
  `-cudnn-runtime-*`. Node 24 must be installed in both (the images are not Node-based).
- Rebuild `@u4/opencv4nodejs` against the custom OpenCV (`OPENCV_INCLUDE_DIR`,
  `OPENCV_LIB_DIR`, `OPENCV4NODEJS_DISABLE_AUTOBUILD=1`, as now). Confirm the binding's
  `cv.DNN_BACKEND_CUDA` / `cv.DNN_TARGET_CUDA` constants are exposed.
- Keep `cv.VideoCapture` (GStreamer/FFmpeg) working in the custom build — enable the same
  videoio backends the apt build provides.
- Code: after `readNetFromONNX`, call `net.setPreferableBackend(cv.DNN_BACKEND_CUDA)` and
  `net.setPreferableTarget(cv.DNN_TARGET_CUDA)`, gated by a config/env flag with automatic
  CPU fallback if CUDA init fails or no device is present.
- Compose: add GPU reservation to `security-server`:
  ```yaml
  deploy:
    resources:
      reservations:
        devices:
          - driver: nvidia
            count: 1
            capabilities: [gpu]
  ```

Risks: long, large image build (tens of minutes; multi-GB image); CUDA/driver version
coupling with the host; `@u4/opencv4nodejs` native rebuild; dev image (bind-mounted, builds
bindings on start) needs the same treatment or stays CPU-only.

### Option B — onnxruntime-node with the CUDA execution provider

- Both models are already ONNX. No OpenCV rebuild; keep apt OpenCV for `VideoCapture` and
  image ops.
- Cost: rewrite blob creation, inference and output decoding in the two services against
  ORT tensors, and move Mats to/from typed arrays (extra copies). Needs a GPU-enabled
  `onnxruntime-node` build (CUDA/cuDNN runtime libs in the image) with Blackwell support
  verified.
- Lower build friction, higher code churn and regression risk in the decode/NMS logic.

## Recommended path

1. Step 0: stats logging + CPU baseline.
2. Spike Option A in a separate branch/image: confirm OpenCV + CUDA 12.8+ builds for sm_120,
   the Node binding exposes the CUDA backend, and YuNet/SFace actually run on it (YuNet's
   ops must all be supported by the CUDA backend, otherwise OpenCV silently falls back per
   layer — check speed, not just absence of errors).
3. If the spike shows a worthwhile gain (e.g. >2x per-frame latency or CPU reduced to a
   fraction), productionize; otherwise stay on CPU or evaluate Option B.

## Implementation checklist (Option A)

Status as of 2026-10-28 (code landed in `e4975e4`, "Added cuda supported docker image").

- [x] Usage stats (Step 0, re-scoped to capacity monitoring rather than a CPU baseline) —
      `UsageStatsService` writes one `ServerStats` row per minute (GPU util/memory via nvidia-smi,
      process CPU, inference-lane busy %, event-loop lag) and one `ChannelStats` row per camera
      (decode size, frames, busy-skips, inference ms). 7-day retention
- [x] New `Dockerfile.production` (CUDA devel build stage, CUDA runtime stage, Node 24)
- [ ] OpenCV + contrib build flags validated for `sm_120` — **partial**: image uses CUDA 12.6.3,
      OpenCV 4.10.0 and `CUDA_ARCH_BIN="6.1;7.5;8.6;8.9"` / `CUDA_ARCH_PTX="8.9"`. The RTX 5060 Ti
      (sm_120) relies on PTX JIT; it does load and run in production (see below), but kernel
      speed under JIT is unmeasured. Needs CUDA >= 12.8 and `12.0` in the arch list, or
      confirmation that the JIT path works
- [x] `@u4/opencv4nodejs` builds against the CUDA OpenCV; the build fails if `getBuildInformation()`
      doesn't report CUDA and cuDNN as YES
- [ ] Confirm `cv.DNN_BACKEND_CUDA` is exposed and works at runtime — observed in production
      2026-10-28: startup logs "YuNet/SFace set to run on CUDA", the node process holds ~376 MiB on
      the GPU at ~5% util, so the backend loads. Still need speed/parity numbers (and note the
      harmless cuDNN "90.5 vs 9.5" version-check warning from OpenCV 4.10 at startup)
- [x] `setPreferableBackend/Target` in face-detection and face-recognition services
      (`recognition/dnn-target.ts`), behind `OPENCV_DNN_TARGET=cuda`, with a startup log line.
      Caveat: CPU fallback relies on OpenCV's own fallback; no explicit device check, and the log
      line states the requested backend, not the confirmed active one
- [x] Compose GPU reservation (production; development not done, optional)
- [ ] Verify: GPU utilization > 0 under load, CPU drops, no change in detection/match results
      (compare scores on a fixed set of test images — CUDA FP differences should be minor).
      Also check YuNet/SFace layers don't silently fall back to CPU (check speed)
- [ ] Verify `VideoCapture` still works in the custom build (FFmpeg on, GStreamer off)
- [ ] Verify the memory-stability fixes (recent "Fixed memory crashes" commit) still hold —
      GPU path may leak differently; soak test for several hours
- [x] Update docs/README with the host requirements (NVIDIA driver >= 525, nvidia-container-toolkit);
      `.env.sample` documents the flag

## Rollback

Implemented: the backend is flagged via `OPENCV_DNN_TARGET` (unset = CPU), so production can
revert to CPU without an image rebuild. The apt-based CPU image is kept as
`Dockerfile.production-local` / `docker-compose.production-local.yml`.

## Open questions

- ~~Is the production host the same machine (RTX 5060 Ti) as this one? Driver version?~~ Answered:
  yes, production is this machine — one RTX 5060 Ti (sm_120) plus the Ryzen 9 9900X's integrated
  AMD GPU, which is unused. NVIDIA driver 595.99.02 (CUDA 13.2). `count: all` is fine; no device
  pinning needed.
- Is a multi-GB image and a slow build acceptable in the deploy pipeline?
- Do we need the dev container GPU-enabled, or only production?
