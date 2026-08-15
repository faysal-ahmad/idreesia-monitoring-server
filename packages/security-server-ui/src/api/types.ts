export type VideoFeedSourceType = 'RTSP' | 'USB';

export interface RtspConfig {
  host: string;
  port: number;
  path: string;
  username?: string;
  password?: string;
}

export interface UsbConfig {
  deviceIndex: number | string;
}

export interface VideoFeedSource {
  id: string;
  name: string;
  type: VideoFeedSourceType;
  config: Partial<RtspConfig> & Partial<UsbConfig>;
  enabled: boolean;
  removable: boolean;
  similarityThreshold: number | null;
  createdAt: string;
  updatedAt: string;
  alertCount: number;
}

export interface VerifyResult {
  reachable: boolean;
  error?: string;
  previewImage?: string;
}

export interface TestMatchResult {
  detectedFaceConfidence: number;
  currentSimilarityThreshold: number | null;
  results: { profileId: string; profileName: string; score: number }[];
}

export interface MonitoringProfileSummary {
  id: string;
  name: string;
  isTest: boolean;
  createdAt: string;
  updatedAt: string;
  imageCount: number;
  alertCount: number;
}

export interface MonitoringProfileImage {
  id: string;
  createdAt: string;
  previewImage: string;
}

export interface MonitoringProfileDetail extends MonitoringProfileSummary {
  images: MonitoringProfileImage[];
}

export type ImageUploadResult =
  | { status: 'rejected'; reason: string }
  | { status: 'warning'; reason: string; faceBox: { width: number; height: number }; confidence: number }
  | { status: 'created'; image: { id: string; createdAt: string } };

export interface Alert {
  id: string;
  timestamp: string;
  similarityScore: number;
  profile: { id: string; name: string };
  channel: { id: string; name: string };
}

export interface Configuration {
  id: string;
  alertsRetentionDays: number;
}
