export interface DetectedFace {
  box: { x: number; y: number; width: number; height: number };
  confidence: number;
  // 5 landmarks in order: right eye, left eye, nose tip, right mouth corner, left mouth corner.
  landmarks: [number, number][];
}
