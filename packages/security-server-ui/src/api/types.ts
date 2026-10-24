export interface RtspConfig {
  host: string;
  port: number;
  path: string;
  username?: string;
  password?: string;
}

export interface VideoFeedSource {
  id: string;
  name: string;
  config: Partial<RtspConfig>;
  enabled: boolean;
  similarityThreshold: number | null;
  recognitionFps: number;
  createdAt: string;
  updatedAt: string;
  alertCount: number;
}

export interface VerifyResult {
  reachable: boolean;
  error?: string;
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

export type AlertReview = 'CORRECT' | 'FALSE_POSITIVE';

export interface Alert {
  id: string;
  // <uuid>.jpg, served from /api/alert-images/<imageFile>.
  imageFile: string;
  timestamp: string;
  similarityScore: number;
  review: AlertReview | null;
  profile: { id: string; name: string; isTest: boolean };
  channel: { id: string; name: string };
}

export interface AlertPage {
  data: Alert[];
  total: number;
}

export interface AlertFilterOptions {
  profiles: { id: string; name: string }[];
  channels: { id: string; name: string }[];
}

export interface Configuration {
  alertsRetentionDays: number;
  includeTestProfilesInAlerts: boolean;
}

export interface AuthSession {
  authenticated: boolean;
}

export type ChannelHealthStatus = 'online' | 'connecting' | 'offline';

export interface ChannelHealth {
  channelId: string;
  name: string;
  status: ChannelHealthStatus;
  lastFrameAt: string | null;
}
