import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { VideoFeedSource } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { VideoCaptureService } from '../recognition/video-capture.service';
import { parseRtspConfig } from '../video-feed-sources/video-feed-source-config.schema';

const DEFAULT_API_URL = 'http://go2rtc:1984';
const DEFAULT_RTSP_URL = 'rtsp://go2rtc:8554';
const RESYNC_INTERVAL_MS = 60_000;
// Ingestion asks for a sync whenever it can't open a re-stream; this caps how often that happens.
const ON_DEMAND_SYNC_MIN_GAP_MS = 10_000;

type Go2rtcStreams = Record<string, { producers: { url: string }[] | null } | null>;

// Keeps the go2rtc media server's streams in step with the enabled channels: one stream per
// channel, named by channel id, sourced from the camera's RTSP URL. go2rtc is then each camera's
// only client — the recognition pipeline and browser viewers all read its re-streams.
//
// The DB is the source of truth. go2rtc only keeps API-added streams in its own container, so
// this re-syncs periodically (and on demand) to recover from go2rtc restarts.
@Injectable()
export class MediaServerService {
  private readonly logger = new Logger(MediaServerService.name);
  private readonly apiUrl = process.env.MEDIA_SERVER_API_URL || DEFAULT_API_URL;
  private readonly rtspUrl = process.env.MEDIA_SERVER_RTSP_URL || DEFAULT_RTSP_URL;
  // Serializes syncs so the periodic, on-demand, and reconcile-driven ones never interleave.
  private queue: Promise<unknown> = Promise.resolve();
  private lastOnDemandSyncAt = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly videoCapture: VideoCaptureService,
  ) {}

  restreamUrl(channelId: string): string {
    return `${this.rtspUrl}/${channelId}`;
  }

  // Returns false (and logs) if go2rtc couldn't be reached; callers carry on and retry later.
  sync(enabledChannels: VideoFeedSource[]): Promise<boolean> {
    const run = this.queue.then(() => this.syncNow(enabledChannels));
    this.queue = run.catch(() => undefined);
    return run;
  }

  @Interval(RESYNC_INTERVAL_MS)
  async syncEnabledChannels(): Promise<boolean> {
    return this.sync(await this.prisma.videoFeedSource.findMany({ where: { enabled: true } }));
  }

  // For callers that just hit a missing/unreachable re-stream (e.g. go2rtc restarted).
  requestSync() {
    const now = Date.now();
    if (now - this.lastOnDemandSyncAt < ON_DEMAND_SYNC_MIN_GAP_MS) return;
    this.lastOnDemandSyncAt = now;
    void this.syncEnabledChannels();
  }

  private async syncNow(enabledChannels: VideoFeedSource[]): Promise<boolean> {
    try {
      const current = await this.request<Go2rtcStreams>('GET', '/api/streams');
      const desired = new Map(
        enabledChannels.map((channel) => [
          channel.id,
          this.videoCapture.buildRtspUrl(parseRtspConfig(channel.config)),
        ]),
      );

      for (const [name, src] of desired) {
        const sources = current[name]?.producers?.map((producer) => producer.url);
        if (!sources) {
          await this.request('PUT', `/api/streams?${new URLSearchParams({ name, src })}`);
        } else if (sources.length !== 1 || sources[0] !== src) {
          await this.request('PATCH', `/api/streams?${new URLSearchParams({ name, src })}`);
        }
      }
      for (const name of Object.keys(current)) {
        if (!desired.has(name)) await this.request('DELETE', `/api/streams?${new URLSearchParams({ src: name })}`);
      }
      return true;
    } catch (error) {
      this.logger.warn(`Could not sync streams with the media server (${this.apiUrl}): ${error}`);
      return false;
    }
  }

  private async request<T = unknown>(method: string, path: string): Promise<T> {
    const response = await fetch(`${this.apiUrl}${path}`, { method });
    if (!response.ok) {
      throw new Error(`${method} ${path.split('?')[0]} → ${response.status} ${await response.text()}`);
    }
    return (method === 'GET' ? response.json() : undefined) as Promise<T>;
  }
}
