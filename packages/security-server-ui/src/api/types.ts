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
  // null = the server default, 0 = no check.
  minFaceSizePx: number | null;
  minFaceQuality: number | null;
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

export type FaceQualitySignal =
  'size' | 'confidence' | 'sharpness' | 'exposure' | 'pose';

export interface FaceQuality {
  // 0-100.
  score: number;
  // Each 0-1, where 1 is ideal.
  signals: Record<FaceQualitySignal, number>;
  reasons: string[];
}

export interface MonitoringProfileImage {
  id: string;
  createdAt: string;
  previewImage: string;
  // null = no face found, or not scored yet.
  quality: FaceQuality | null;
}

export interface MonitoringProfileDetail extends MonitoringProfileSummary {
  images: MonitoringProfileImage[];
}

export type ImageUploadResult =
  | { status: 'rejected'; reason: string }
  | {
      status: 'warning';
      reason: string;
      faceBox: { width: number; height: number };
      confidence: number;
    }
  | {
      status: 'created';
      image: { id: string; createdAt: string; quality: FaceQuality };
    };

export interface Alert {
  id: string;
  // <uuid>.jpg, served from /api/alert-images/<imageFile>.
  imageFile: string;
  timestamp: string;
  similarityScore: number;
  // The matched face's shorter side (native px) and quality; null on older alerts.
  faceSizePx: number | null;
  faceQuality: FaceQuality | null;
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
  erpSyncIntervalMinutes: number;
  erpAlertRetryIntervalMinutes: number;
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

export interface ErpStatus {
  // false when ERP_URL / ERP_USERNAME / ERP_PASSWORD aren't set on the server.
  configured: boolean;
  lastSyncedAt: string | null;
  lastSyncError: string | null;
  pendingAlerts: number;
  lastPushError: string | null;
}

export interface ErpSyncSummary {
  // Applied here from the ERP.
  pulled: { channels: number; profiles: number; photos: number };
  // ERP changes not applied because the record had also changed here (this server's version wins).
  conflicts: number;
  // Sent to the ERP.
  pushed: { channels: number; profiles: number };
  // Deleted, but kept until their alerts reach the ERP.
  deferred: number;
}

// Averages and maxima are over the stats windows in the range; "latest" values are from its last
// window.
export interface ServerUsage {
  windowCount: number;
  activeChannels: number;
  dnnTarget: string;
  inferenceBusyAvgPct: number | null;
  inferenceBusyMaxPct: number | null;
  // Null when no NVIDIA GPU is visible.
  gpuUtilAvgPct: number | null;
  gpuUtilMaxPct: number | null;
  gpuMemUsedMb: number | null;
  gpuMemTotalMb: number | null;
  // Percent of one core, so 250 = 2.5 cores.
  cpuAvgPct: number | null;
  cpuCores: number;
  eventLoopLagP95Ms: number | null;
  eventLoopLagMaxMs: number | null;
}

export interface ChannelUsage {
  channelId: string;
  name: string;
  recognitionFps: number;
  frameWidth: number | null;
  frameHeight: number | null;
  readFps: number;
  processedFps: number;
  busySkipPct: number;
  inferenceSharePct: number;
  // Faces that passed the size and quality checks and were matched.
  faces: number;
  skippedFaceSize: number;
  skippedFaceQuality: number;
  faceSkipPct: number;
  readFailures: number;
  reconnects: number;
}

export interface UsageStatsSummary {
  minutes: number;
  // false when STATS_INTERVAL_SECONDS=0 on the server.
  statsEnabled: boolean;
  coveredSeconds: number;
  server: ServerUsage | null;
  channels: ChannelUsage[];
}
