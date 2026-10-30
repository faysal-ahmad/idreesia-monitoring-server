import { VideoFeedSource } from '@prisma/client';
import { FaceQuality } from '../../recognition/face-quality.service';
import { ChannelWindow } from '../channel-stats-recorder';

// Messages between IngestionProcessPoolService (main process) and the ingestion processes it
// forks (ingestion-process.main.ts). Sent over Node's IPC channel with 'advanced' serialization,
// so Dates and Buffers (as Uint8Array) survive the trip.

export interface CachedEmbedding {
  profileId: string;
  profileName: string;
  embedding: number[];
}

export interface AssignedChannel {
  channel: VideoFeedSource;
  // The channel's go2rtc re-stream; ingestion processes never connect to cameras directly.
  restreamUrl: string;
}

export type MainToProcessMessage =
  // The full set of channels this process should be reading. Loops are started, stopped or
  // updated to match, the way VideoIngestionService.reconcile() always worked.
  | { type: 'setChannels'; channels: AssignedChannel[] }
  | { type: 'setMatchCache'; entries: CachedEmbedding[] }
  | { type: 'collectStats'; requestId: number }
  | { type: 'stop' };

export interface ChannelHealthReport {
  channelId: string;
  // 0 until the channel's first frame.
  lastFrameAt: number;
  reconnectAttempts: number;
  frameWidth?: number;
  frameHeight?: number;
}

export interface AlertEvent {
  channelId: string;
  profileId: string;
  profileName: string;
  score: number;
  faceSizePx: number;
  quality: FaceQuality;
  // JPEG snapshot with the matched face marked.
  image: Uint8Array;
}

export interface ProcessStats {
  windows: Record<string, ChannelWindow>;
  // Microseconds since the previous collectStats, as process.cpuUsage() reports them.
  cpuUserUs: number;
  cpuSystemUs: number;
  eventLoopLagP95Ms: number;
  eventLoopLagMaxMs: number;
}

export type ProcessToMainMessage =
  // Models are loaded and the process is listening; the main process then sends its state.
  | { type: 'ready' }
  | { type: 'health'; channels: ChannelHealthReport[] }
  | { type: 'alert'; alert: AlertEvent }
  // The process has already stopped this channel's loop; the main process disables it.
  | { type: 'unreachable'; channelId: string; reason: string }
  // A re-stream was missing, likely because go2rtc restarted.
  | { type: 'requestStreamSync' }
  | { type: 'stats'; requestId: number; stats: ProcessStats };
