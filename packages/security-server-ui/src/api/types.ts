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

// Box is YuNet's own (unpadded) face box, in the analyzed image's pixels.
export interface AnalyzedFace {
  box: { x: number; y: number; width: number; height: number };
  confidence: number;
  sizePx: number;
  quality: number;
  qualityReasons: string[];
  // The best-scoring profile (test or not) at or above the channel's threshold; null = no match.
  match: {
    profileId: string;
    profileName: string;
    isTest: boolean;
    score: number;
  } | null;
}

export interface FrameAnalysis {
  width: number;
  height: number;
  // The channel's effective minimums (its own, or the server default); 0 = check off.
  minFaceSizePx: number;
  minFaceQuality: number;
  // The channel's effective similarity threshold, used for each face's match.
  similarityThreshold: number;
  faces: AnalyzedFace[];
}

export interface MonitoringProfileSummary {
  id: string;
  name: string;
  isTest: boolean;
  createdAt: string;
  updatedAt: string;
  imageCount: number;
  alertCount: number;
  // One of its photos, shown on the list; null when it has none.
  thumbnailImageId: string | null;
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
}

export interface MonitoringProfileDetail extends MonitoringProfileSummary {
  // The photo used as the list thumbnail (its oldest, if none was chosen); null with no photos.
  defaultImageId: string | null;
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
      image: { id: string; createdAt: string };
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
  usageStatsIntervalSeconds: number;
  usageStatsRetentionDays: number;
  includeTestProfilesInAlerts: boolean;
  erpUrl: string;
  erpUsername: string;
  // The password itself is never sent to the UI.
  hasErpPassword: boolean;
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
  // false until the ERP URL, username and password are set on the Configuration page.
  configured: boolean;
  lastSyncedAt: string | null;
  lastSyncError: string | null;
  pendingAlerts: number;
  lastPushError: string | null;
  // End of the last 5-minute usage-stats bucket the ERP has received.
  usageStatsPushedUntil: string | null;
  lastUsageStatsPushError: string | null;
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
  // false when the Usage Stats Interval setting is 0.
  statsEnabled: boolean;
  coveredSeconds: number;
  server: ServerUsage | null;
  channels: ChannelUsage[];
}
