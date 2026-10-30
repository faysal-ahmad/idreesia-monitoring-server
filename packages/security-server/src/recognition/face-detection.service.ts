import { Injectable, OnModuleInit } from '@nestjs/common';
import * as cv from '@u4/opencv4nodejs';
import { applyDnnTarget, warmUpDnn } from './dnn-target';
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

// Most live-frame input shapes kept loaded at once (see netForShape). There's one shape per
// distinct camera resolution and min face size, so this is well above any real deployment.
const MAX_LIVE_NETS = 16;

// A Mat's elements as float32s (YuNet's outputs are CV_32F). The outputs are 3D ([1, anchors, n])
// and getData() only takes 2D Mats, so it reads through a 2D view (flattenFloat shares the memory,
// copying nothing). getData() copies into a fresh Buffer, which Node may place at an offset in its
// shared pool; Float32Array needs that offset 4-aligned.
function floatData(mat: cv.Mat): Float32Array {
  const [, anchors, values] = mat.sizes;
  const flat = mat.flattenFloat(anchors, values);
  let data: Buffer;
  try {
    data = flat.getData();
  } finally {
    flat.release();
  }
  return data.byteOffset % 4 === 0
    ? new Float32Array(data.buffer, data.byteOffset, data.byteLength / 4)
    : new Float32Array(new Uint8Array(data).buffer);
}

// Ported from OpenCV's FaceDetectorYNImpl::postProcess (modules/objdetect/src/face_detect.cpp) —
// this Node binding (@u4/opencv4nodejs) doesn't wrap FaceDetectorYN, only the generic cv.dnn
// module, so YuNet's anchor-based raw output has to be decoded by hand exactly as the C++ does.
@Injectable()
export class FaceDetectionService implements OnModuleInit {
  // Profile photos come in every size, so they share one net that re-sizes itself as needed.
  private photoNet!: cv.Net;
  // Live frames get one net per input shape. Giving an OpenCV DNN net an input of a different shape
  // makes it set itself up again (on CUDA: cuDNN descriptors and buffers), which costs far more than
  // the inference itself; with cameras of different resolutions sharing one net, that happened on
  // nearly every frame. Map order is least recently used first.
  private readonly liveNets = new Map<string, cv.Net>();

  onModuleInit() {
    this.photoNet = this.loadNet();
    // Through the photo net, so no dummy shape takes a slot among the live nets. The CUDA context
    // and compiled kernels are shared by every net in the process; a live net's first frame still
    // sets up its own descriptors and buffers, roughly the ~100 ms a shape change used to cost.
    warmUpDnn('YuNet', () => {
      const blank = new cv.Mat(320, 320, cv.CV_8UC3, [0, 0, 0]);
      try {
        this.detect(blank);
      } finally {
        blank.release();
      }
    });
  }

  private loadNet(): cv.Net {
    const net = cv.readNetFromONNX(YUNET_MODEL_PATH);
    applyDnnTarget(net, 'YuNet');
    return net;
  }

  private netForShape(width: number, height: number): cv.Net {
    const key = `${width}x${height}`;
    let net = this.liveNets.get(key);
    if (net) {
      this.liveNets.delete(key);
    } else {
      net = this.loadNet();
      if (this.liveNets.size >= MAX_LIVE_NETS) {
        // The binding has no explicit release for a Net; dropping it leaves it to the GC.
        const oldest = this.liveNets.keys().next().value as string;
        this.liveNets.delete(oldest);
      }
    }
    this.liveNets.set(key, net);
    return net;
  }

  // scoreThreshold: 0.6-0.9 is a moderately permissive range for enrollment (see docs/face-recognition.md);
  // stricter defaults are tuned for clean studio photos, not uncontrolled social-media enrollment photos.
  // allowFallback: the downscaled retry below is for close-up profile photos only. Live camera
  // frames pass false - their faces are never that large, and most frames have no face at all, so
  // the retry would just run detection twice on every empty frame.
  detect(
    image: cv.Mat,
    scoreThreshold = 0.7,
    nmsThreshold = 0.3,
    allowFallback = true,
  ): DetectedFace[] {
    // allowFallback is only ever set for profile photos, so it doubles as the live/photo split.
    const live = !allowFallback;
    const faces = this.detectAtFullSize(
      image,
      scoreThreshold,
      nmsThreshold,
      live,
    );
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
      return this.detectAtFullSize(
        resized,
        scoreThreshold,
        nmsThreshold,
        live,
      ).map((face) => unscaleFace(face, scale));
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
    live: boolean,
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

    const net = live ? this.netForShape(padW, padH) : this.photoNet;
    net.setInput(blob);
    const outputs = net.forward(OUTPUT_NAMES);
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

      // The outputs are [1, anchors, 1|4|10] float Mats, read as flat arrays: anchor idx's values
      // start at idx * 1|4|10. Only the anchors that pass the score threshold - a handful out of
      // thousands - have their box and landmarks read.
      const clsData = floatData(cls[strideIdx]);
      const objData = floatData(obj[strideIdx]);
      const bboxData = floatData(bbox[strideIdx]);
      const kpsData = floatData(kps[strideIdx]);

      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const idx = r * cols + c;
          const clsScore = Math.min(Math.max(clsData[idx], 0), 1);
          const objScore = Math.min(Math.max(objData[idx], 0), 1);
          const score = Math.sqrt(clsScore * objScore);
          if (score < scoreThreshold) continue;

          const b = idx * 4;
          const cx = (c + bboxData[b]) * stride;
          const cy = (r + bboxData[b + 1]) * stride;
          const w = Math.exp(bboxData[b + 2]) * stride;
          const h = Math.exp(bboxData[b + 3]) * stride;
          const x1 = cx - w / 2;
          const y1 = cy - h / 2;

          const k = idx * 10;
          const landmarks: [number, number][] = [];
          for (let n = 0; n < 5; n++) {
            landmarks.push([
              (kpsData[k + 2 * n] + c) * stride,
              (kpsData[k + 2 * n + 1] + r) * stride,
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
