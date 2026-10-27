import { Injectable } from '@nestjs/common';
import * as cv from '@u4/opencv4nodejs';
import { DetectedFace } from './recognition.types';

export type FaceQualitySignal =
  'size' | 'confidence' | 'sharpness' | 'exposure' | 'pose';

export interface FaceQuality {
  // 0-100, the weighted mean of the signals below.
  score: number;
  // Each 0-1, where 1 is ideal.
  signals: Record<FaceQualitySignal, number>;
  // Human-readable reasons for every signal that scored poorly.
  reasons: string[];
}

// Starting weights, to be tuned against the test-match flow. Size, sharpness and pose dominate
// because they're what most limits SFace's 112x112 embedding on uncontrolled social-media photos.
const WEIGHTS: Record<FaceQualitySignal, number> = {
  size: 0.25,
  sharpness: 0.25,
  pose: 0.25,
  confidence: 0.15,
  exposure: 0.1,
};

// Face box shorter side, in source-image pixels. The floor matches the upload hard-reject
// (MonitoringProfileService's HARD_REJECT_MIN_PX); beyond the ceiling more pixels add nothing,
// since the face is downscaled to 112x112 anyway.
const SIZE_MIN_PX = 40;
const SIZE_MAX_PX = 160;
// YuNet score. The floor is the permissive upload detection threshold.
const CONFIDENCE_MIN = 0.6;
const CONFIDENCE_MAX = 0.95;
// Variance of the Laplacian on the aligned grayscale crop - a standard blur measure. Mapped on a
// log scale, since it spans orders of magnitude between a smeared and a crisp face.
const SHARPNESS_MIN_VARIANCE = 30;
const SHARPNESS_MAX_VARIANCE = 600;
// Grayscale crop brightness: ideal at mid-grey, unusable this far either side of it.
const BRIGHTNESS_IDEAL = 128;
const BRIGHTNESS_TOLERANCE = 88;
// Grayscale crop standard deviation: below the floor the face is flat/washed out.
const CONTRAST_MIN_STDDEV = 15;
const CONTRAST_MAX_STDDEV = 40;
// Pose, from the 5 landmarks. Roll is ignored: alignment rotates it away before embedding.
// Yaw: nose offset from the eye midpoint along the eye line, as a fraction of eye distance.
const YAW_MAX_RATIO = 0.35;
// Pitch: (eyes -> nose) / (eyes -> mouth) perpendicular to the eye line. 0.49 is the ratio in
// SFace's own frontal alignment target (DST_POINTS in face-recognition.service.ts).
const PITCH_FRONTAL_RATIO = 0.49;
const PITCH_MAX_DEVIATION = 0.2;
// A signal below this adds its reason.
const REASON_THRESHOLD = 0.5;

const REASONS: Record<FaceQualitySignal, string> = {
  size: 'Face is small',
  confidence: 'Low detection confidence',
  sharpness: 'Blurry',
  exposure: 'Too dark, too bright or low contrast',
  pose: 'Face turned away',
};

function clamp01(value: number): number {
  return Math.min(Math.max(value, 0), 1);
}

function linear(value: number, min: number, max: number): number {
  return clamp01((value - min) / (max - min));
}

// Rates how usable a detected face is for recognition, from what detection and alignment already
// produced - no extra model. A heuristic for the admin's benefit; it doesn't gate matching.
@Injectable()
export class FaceQualityService {
  assess(face: DetectedFace, aligned: cv.Mat): FaceQuality {
    const gray = aligned.bgrToGray();
    let signals: Record<FaceQualitySignal, number>;
    try {
      signals = {
        size: linear(
          Math.min(face.box.width, face.box.height),
          SIZE_MIN_PX,
          SIZE_MAX_PX,
        ),
        confidence: linear(face.confidence, CONFIDENCE_MIN, CONFIDENCE_MAX),
        sharpness: this.sharpness(gray),
        exposure: this.exposure(gray),
        pose: this.pose(face.landmarks),
      };
    } finally {
      gray.release();
    }

    const weighted = (Object.keys(WEIGHTS) as FaceQualitySignal[]).reduce(
      (sum, signal) => sum + WEIGHTS[signal] * signals[signal],
      0,
    );
    const reasons = (Object.keys(REASONS) as FaceQualitySignal[])
      .filter((signal) => signals[signal] < REASON_THRESHOLD)
      .map((signal) => REASONS[signal]);

    return { score: Math.round(weighted * 100), signals, reasons };
  }

  private sharpness(gray: cv.Mat): number {
    const laplacian = gray.laplacian(cv.CV_64F);
    const { mean, stddev } = laplacian.meanStdDev();
    const variance = stddev.at(0, 0) ** 2;
    laplacian.release();
    mean.release();
    stddev.release();
    if (variance <= 0) return 0;
    return linear(
      Math.log10(variance),
      Math.log10(SHARPNESS_MIN_VARIANCE),
      Math.log10(SHARPNESS_MAX_VARIANCE),
    );
  }

  private exposure(gray: cv.Mat): number {
    const { mean, stddev } = gray.meanStdDev();
    const brightness = clamp01(
      1 - Math.abs(mean.at(0, 0) - BRIGHTNESS_IDEAL) / BRIGHTNESS_TOLERANCE,
    );
    const contrast = linear(
      stddev.at(0, 0),
      CONTRAST_MIN_STDDEV,
      CONTRAST_MAX_STDDEV,
    );
    mean.release();
    stddev.release();
    return Math.min(brightness, contrast);
  }

  // Landmark order: right eye, left eye, nose tip, right mouth corner, left mouth corner.
  private pose(landmarks: [number, number][]): number {
    const [rightEye, leftEye, nose, rightMouth, leftMouth] = landmarks;
    const eyeDx = leftEye[0] - rightEye[0];
    const eyeDy = leftEye[1] - rightEye[1];
    const eyeDistance = Math.hypot(eyeDx, eyeDy);
    if (eyeDistance < 1e-6) return 0;

    // Unit vectors along and perpendicular to the eye line, so the measures are roll-invariant.
    const ux = eyeDx / eyeDistance;
    const uy = eyeDy / eyeDistance;
    const eyeMid = [
      (rightEye[0] + leftEye[0]) / 2,
      (rightEye[1] + leftEye[1]) / 2,
    ];
    const mouthMid = [
      (rightMouth[0] + leftMouth[0]) / 2,
      (rightMouth[1] + leftMouth[1]) / 2,
    ];
    const along = (p: number[]) =>
      (p[0] - eyeMid[0]) * ux + (p[1] - eyeMid[1]) * uy;
    const across = (p: number[]) =>
      -(p[0] - eyeMid[0]) * uy + (p[1] - eyeMid[1]) * ux;

    const yaw = clamp01(
      1 - Math.abs(along(nose) / eyeDistance) / YAW_MAX_RATIO,
    );
    const mouthDepth = across(mouthMid);
    const pitch =
      mouthDepth <= 0
        ? 0
        : clamp01(
            1 -
              Math.abs(across(nose) / mouthDepth - PITCH_FRONTAL_RATIO) /
                PITCH_MAX_DEVIATION,
          );
    return Math.min(yaw, pitch);
  }
}
