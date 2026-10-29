import { DetectedFace } from './recognition.types';

// Faces smaller than this (shorter side of the box, in the camera's native pixels) are skipped
// before matching: too few pixels for a trustworthy embedding or for a reviewer to confirm.
// Used whenever a channel's minFaceSizePx is null; 0 turns the check off.
export const DEFAULT_MIN_FACE_SIZE_PX = 96;
// Faces scoring below this (FaceQualityService, 0-100) are skipped before matching. Used whenever
// a channel's minFaceQuality is null; 0 turns the check off.
export const DEFAULT_MIN_FACE_QUALITY = 40;
// Smallest face (shorter side, px at detection resolution) YuNet finds reliably - its finest anchor
// stride is 8px.
const YUNET_RELIABLE_FACE_PX = 32;

export function resolveMinFaceSize(channelValue: number | null): number {
  return channelValue ?? DEFAULT_MIN_FACE_SIZE_PX;
}

export function resolveMinFaceQuality(channelValue: number | null): number {
  return channelValue ?? DEFAULT_MIN_FACE_QUALITY;
}

// Scaling a frame down only makes detection cheaper (YuNet's cost grows with pixel count); what it
// costs is the smallest face it can still find. Faces under the channel's minimum are skipped
// anyway, so detect at the lowest resolution that still finds every face at that minimum. With the
// check off (0), detect at full resolution.
export function detectionScaleFor(minFaceSize: number): number {
  return minFaceSize > 0
    ? Math.min(1, YUNET_RELIABLE_FACE_PX / minFaceSize)
    : 1;
}

// Maps a face found on a frame scaled by `scale` back to the original frame's coordinates.
export function unscaleFace(face: DetectedFace, scale: number): DetectedFace {
  if (scale === 1) return face;
  return {
    box: {
      x: face.box.x / scale,
      y: face.box.y / scale,
      width: face.box.width / scale,
      height: face.box.height / scale,
    },
    confidence: face.confidence,
    landmarks: face.landmarks.map(([x, y]): [number, number] => [
      x / scale,
      y / scale,
    ]),
  };
}

// Shorter side of the face box, rounded - the measure the size check and alerts use.
export function faceSizePx(face: DetectedFace): number {
  return Math.round(Math.min(face.box.width, face.box.height));
}
