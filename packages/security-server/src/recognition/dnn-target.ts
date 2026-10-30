import { Logger } from '@nestjs/common';
import * as cv from '@u4/opencv4nodejs';

const logger = new Logger('DnnTarget');

// OPENCV_DNN_TARGET=cuda (set in .env) runs the face models on the GPU. That needs the CUDA build of
// OpenCV (packages/security-server/Dockerfile.production) and a GPU passed through to the container
// (see docker-compose.production.yml); if either is missing, OpenCV logs a warning and falls back to
// the CPU. Unset, the nets keep OpenCV's default CPU backend.
export function applyDnnTarget(net: cv.Net, modelName: string): void {
  if (process.env.OPENCV_DNN_TARGET !== 'cuda') return;

  net.setPreferableBackend(cv.DNN_BACKEND_CUDA);
  net.setPreferableTarget(cv.DNN_TARGET_CUDA);
  logger.log(`${modelName} set to run on CUDA`);
}

// On CUDA a net's first forward pass sets up the CUDA context, cuDNN and the kernels (JIT-compiled
// from PTX on GPUs newer than the image was built for), which took 3-6 s in production. Left to the
// first live face, that blocks the whole process and stalls every channel it reads. Running one
// dummy pass at startup moves the cost there. On the CPU there's nothing to warm up.
export function warmUpDnn(modelName: string, forward: () => void): void {
  if (process.env.OPENCV_DNN_TARGET !== 'cuda') return;

  const start = Date.now();
  forward();
  logger.log(`${modelName} warmed up in ${Date.now() - start} ms`);
}
