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
