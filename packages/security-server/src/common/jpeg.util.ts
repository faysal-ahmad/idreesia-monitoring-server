import * as cv from '@u4/opencv4nodejs';

// Encodes an image as JPEG with its long side capped at maxSide (never upscaled).
export function encodeJpeg(
  image: cv.Mat,
  maxSide: number,
  quality = 90,
): Buffer {
  const resized =
    Math.max(image.cols, image.rows) > maxSide
      ? image.resizeToMax(maxSide)
      : null;
  try {
    return cv.imencode('.jpg', resized ?? image, [
      cv.IMWRITE_JPEG_QUALITY,
      quality,
    ]);
  } finally {
    resized?.release();
  }
}
