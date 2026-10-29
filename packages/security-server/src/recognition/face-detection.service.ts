import { Injectable, OnModuleInit } from '@nestjs/common';
import * as cv from '@u4/opencv4nodejs';
import { applyDnnTarget } from './dnn-target';
import { unscaleFace } from './face-gate';
import { YUNET_MODEL_PATH } from './model-paths';
import { DetectedFace } from './recognition.types';

const DIVISOR = 32;
// Long side an image is downscaled to when full-size detection finds nothing (see detect()).
// 640 is the input size OpenCV's own YuNet samples use; measured on a 2041x2048 close-up whose
// ~1000px face was missed at full size and at 1280, but found at 960 and below.
const FALLBACK_MAX_SIDE = 640;
const STRIDES = [8, 16, 32];
const OUTPUT_NAMES = [
  'cls_8',
  'cls_16',
  'cls_32',
  'obj_8',
  'obj_16',
  'obj_32',
  'bbox_8',
  'bbox_16',
  'bbox_32',
  'kps_8',
  'kps_16',
  'kps_32',
];

// Ported from OpenCV's FaceDetectorYNImpl::postProcess (modules/objdetect/src/face_detect.cpp) —
// this Node binding (@u4/opencv4nodejs) doesn't wrap FaceDetectorYN, only the generic cv.dnn
// module, so YuNet's anchor-based raw output has to be decoded by hand exactly as the C++ does.
@Injectable()
export class FaceDetectionService implements OnModuleInit {
  private net!: cv.Net;

  onModuleInit() {
    this.net = cv.readNetFromONNX(YUNET_MODEL_PATH);
    applyDnnTarget(this.net, 'YuNet');
  }

  // scoreThreshold: 0.6-0.9 is a moderately permissive default per the plan's quality-gate guidance
  // (stricter defaults are tuned for clean studio photos, not uncontrolled social-media enrollment photos).
  // allowFallback: the downscaled retry below is for close-up profile photos only. Live camera
  // frames pass false - their faces are never that large, and most frames have no face at all, so
  // the retry would just run detection twice on every empty frame.
  detect(
    image: cv.Mat,
    scoreThreshold = 0.7,
    nmsThreshold = 0.3,
    allowFallback = true,
  ): DetectedFace[] {
    const faces = this.detectAtFullSize(image, scoreThreshold, nmsThreshold);
    const longSide = Math.max(image.cols, image.rows);
    if (faces.length > 0 || !allowFallback || longSide <= FALLBACK_MAX_SIDE) {
      return faces;
    }

    // YuNet's largest anchor stride is 32px, so a face filling most of a high-resolution photo
    // (e.g. a ~1000px face in a 2000px close-up selfie) is far bigger than anything it can match
    // and goes undetected at full size. Retry on a downscaled copy and map the results back, so
    // callers always get original-image coordinates.
    const scale = FALLBACK_MAX_SIDE / longSide;
    const resized = image.resize(
      Math.round(image.rows * scale),
      Math.round(image.cols * scale),
    );
    try {
      return this.detectAtFullSize(resized, scoreThreshold, nmsThreshold).map(
        (face) => unscaleFace(face, scale),
      );
    } finally {
      resized.release();
    }
  }

  // Every Mat created here is released explicitly. Left to the garbage collector, the binding frees
  // each Mat's native buffer from a GC finalizer, and with this many Mats per frame that runs into
  // a V8 fatal error ("Fatal error ... Check failed" in Isolate::AdjustAmountOfExternalAllocatedMemory,
  // reached from cv::Mat::~Mat) that kills the process.
  private detectAtFullSize(
    image: cv.Mat,
    scoreThreshold: number,
    nmsThreshold: number,
  ): DetectedFace[] {
    const inputW = image.cols;
    const inputH = image.rows;
    const padW = (Math.floor((inputW - 1) / DIVISOR) + 1) * DIVISOR;
    const padH = (Math.floor((inputH - 1) / DIVISOR) + 1) * DIVISOR;

    const padded = image.copyMakeBorder(
      0,
      padH - inputH,
      0,
      padW - inputW,
      cv.BORDER_CONSTANT,
      new cv.Vec3(0, 0, 0),
    );
    const blob = cv.blobFromImage(padded);
    padded.release();

    this.net.setInput(blob);
    const outputs = this.net.forward(OUTPUT_NAMES);
    blob.release();

    const cls = outputs.slice(0, 3);
    const obj = outputs.slice(3, 6);
    const bbox = outputs.slice(6, 9);
    const kps = outputs.slice(9, 12);

    try {
      return this.decode(
        cls,
        obj,
        bbox,
        kps,
        padW,
        padH,
        scoreThreshold,
        nmsThreshold,
      );
    } finally {
      outputs.forEach((output) => output.release());
    }
  }

  private decode(
    cls: cv.Mat[],
    obj: cv.Mat[],
    bbox: cv.Mat[],
    kps: cv.Mat[],
    padW: number,
    padH: number,
    scoreThreshold: number,
    nmsThreshold: number,
  ): DetectedFace[] {
    const boxes: cv.Rect[] = [];
    const scores: number[] = [];
    const rawFaces: {
      box: cv.Rect;
      score: number;
      landmarks: [number, number][];
    }[] = [];

    STRIDES.forEach((stride, strideIdx) => {
      const cols = Math.floor(padW / stride);
      const rows = Math.floor(padH / stride);

      // getDataAsArray() has both a number[][] and number[][][] overload with identical
      // (empty) parameter lists, so TS always infers the first — these Mats are actually
      // 3D at runtime (confirmed via smoke test), hence the unknown bridge.
      const clsData = cls[
        strideIdx
      ].getDataAsArray() as unknown as number[][][];
      const objData = obj[
        strideIdx
      ].getDataAsArray() as unknown as number[][][];
      const bboxData = bbox[
        strideIdx
      ].getDataAsArray() as unknown as number[][][];
      const kpsData = kps[
        strideIdx
      ].getDataAsArray() as unknown as number[][][];

      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const idx = r * cols + c;
          const clsScore = Math.min(Math.max(clsData[0][idx][0], 0), 1);
          const objScore = Math.min(Math.max(objData[0][idx][0], 0), 1);
          const score = Math.sqrt(clsScore * objScore);
          if (score < scoreThreshold) continue;

          const bboxRow = bboxData[0][idx];
          const cx = (c + bboxRow[0]) * stride;
          const cy = (r + bboxRow[1]) * stride;
          const w = Math.exp(bboxRow[2]) * stride;
          const h = Math.exp(bboxRow[3]) * stride;
          const x1 = cx - w / 2;
          const y1 = cy - h / 2;

          const kpsRow = kpsData[0][idx];
          const landmarks: [number, number][] = [];
          for (let n = 0; n < 5; n++) {
            landmarks.push([
              (kpsRow[2 * n] + c) * stride,
              (kpsRow[2 * n + 1] + r) * stride,
            ]);
          }

          const box = new cv.Rect(x1, y1, w, h);
          boxes.push(box);
          scores.push(score);
          rawFaces.push({ box, score, landmarks });
        }
      }
    });

    if (rawFaces.length === 0) return [];

    const keepIndices =
      rawFaces.length > 1
        ? cv.NMSBoxes(boxes, scores, scoreThreshold, nmsThreshold, {
            eta: 1,
            topK: 0,
          })
        : [0];

    return keepIndices.map((i) => ({
      box: {
        x: rawFaces[i].box.x,
        y: rawFaces[i].box.y,
        width: rawFaces[i].box.width,
        height: rawFaces[i].box.height,
      },
      confidence: rawFaces[i].score,
      landmarks: rawFaces[i].landmarks,
    }));
  }
}
