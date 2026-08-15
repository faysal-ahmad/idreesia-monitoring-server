import { join } from 'path';

// dist/main.js (webpack, target: node, real __dirname) sits at packages/security-server/dist —
// models/ is a sibling checked-in asset directory, not something webpack bundles.
const MODELS_DIR = join(__dirname, '..', 'models');

export const YUNET_MODEL_PATH = join(MODELS_DIR, 'face_detection_yunet_2023mar.onnx');
export const SFACE_MODEL_PATH = join(MODELS_DIR, 'face_recognition_sface_2021dec.onnx');
