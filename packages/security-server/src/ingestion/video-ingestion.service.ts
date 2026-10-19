import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { VideoFeedSource } from '@prisma/client';
import * as cv from '@u4/opencv4nodejs';
import { MediaServerService } from '../media-server/media-server.service';
import { PrismaService } from '../prisma/prisma.service';
import { AlertPipelineService } from './alert-pipeline.service';

// Frames are always read (to stay near-live and drain the stream buffer), but only handed off
// downstream at the channel's recognitionFps, to cap CPU load. Paced by time rather than by
// frame count so the rate doesn't depend on the camera's own frame rate.
// Downscale factor applied to frames before handing them off downstream.
const DOWNSCALE_FACTOR = 0.5;
const MAX_CONSECUTIVE_FAILURES = 5;
// Reconnects back off from 5s to 60s and keep going indefinitely. A camera or media-server outage
// is usually temporary, so channels are never switched off automatically — they resume by
// themselves once the stream is back.
const RECONNECT_BACKOFF_MIN_MS = 5_000;
const RECONNECT_BACKOFF_MAX_MS = 60_000;

interface ChannelLoop {
  channel: VideoFeedSource;
  stopped: boolean;
  capture?: cv.VideoCapture;
  lastProcessedAt: number;
  consecutiveFailures: number;
  // Consecutive failed (re)connects, driving the backoff; reset once frames flow again.
  reconnectAttempts: number;
  donePromise: Promise<void>;
  // Guards against overlapping detection work if it's slower than the frame-skip interval —
  // a frame is simply dropped rather than queued if the previous one is still processing.
  processing: boolean;
}

function backoffMs(attempt: number): number {
  return Math.min(RECONNECT_BACKOFF_MIN_MS * 2 ** Math.max(0, attempt - 1), RECONNECT_BACKOFF_MAX_MS);
}

// Sleeps in short slices so a stopped loop (channel disabled, app shutting down) exits promptly
// instead of finishing a backoff of up to a minute first.
async function sleepUnlessStopped(loop: ChannelLoop, ms: number): Promise<void> {
  const until = Date.now() + ms;
  while (!loop.stopped && Date.now() < until) {
    await new Promise((resolve) => setTimeout(resolve, Math.min(500, until - Date.now())));
  }
}

function configsEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

// Manages one continuous read loop per enabled channel, reading the channel's re-stream from the
// go2rtc media server (see MediaServerService) rather than the camera itself. There's no periodic DB polling here —
// channel create/update/delete all happen through the UI, so `reconcile()` only runs once at
// startup and whenever the /system/reload endpoint is called (see SystemController), which the
// UI hits right after any channel mutation. Uses VideoCapture's async API (readAsync) throughout
// — the sync API blocks the whole Node event loop per frame, which is fine for the one-shot
// verify/test-match actions elsewhere but not for a long-running loop running alongside the API.
@Injectable()
export class VideoIngestionService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(VideoIngestionService.name);
  private readonly loops = new Map<string, ChannelLoop>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly mediaServer: MediaServerService,
    private readonly alertPipeline: AlertPipelineService,
  ) {}

  async onModuleInit() {
    await this.reconcile();
  }

  async onModuleDestroy() {
    await Promise.all(Array.from(this.loops.values()).map((loop) => this.stopLoop(loop)));
  }

  async reconcile() {
    const enabledChannels = await this.prisma.videoFeedSource.findMany({ where: { enabled: true } });
    const enabledById = new Map(enabledChannels.map((channel) => [channel.id, channel]));
    // Streams first, so loops (re)opening below find them. If go2rtc is unreachable, loops just
    // keep retrying and the periodic resync adds the streams once it's back.
    await this.mediaServer.sync(enabledChannels);

    const stopPromises: Promise<void>[] = [];
    for (const [channelId, loop] of this.loops) {
      if (!enabledById.has(channelId)) {
        stopPromises.push(this.stopLoop(loop));
        this.loops.delete(channelId);
      }
    }
    await Promise.all(stopPromises);

    for (const [channelId, channel] of enabledById) {
      const existingLoop = this.loops.get(channelId);
      if (!existingLoop) {
        this.startLoop(channel);
        continue;
      }

      // Already running — refresh the in-memory snapshot so name/similarityThreshold/recognitionFps changes
      // take effect immediately. If the connection details changed, go2rtc's stream source was
      // just updated by sync() above; reconnect so the loop reads from the new camera source.
      const configChanged = !configsEqual(existingLoop.channel.config, channel.config);
      existingLoop.channel = channel;
      if (configChanged && existingLoop.capture) {
        existingLoop.capture.release();
        existingLoop.capture = undefined;
      }
    }
  }

  private startLoop(channel: VideoFeedSource) {
    const loop: ChannelLoop = {
      channel,
      stopped: false,
      lastProcessedAt: 0,
      consecutiveFailures: 0,
      reconnectAttempts: 0,
      donePromise: Promise.resolve(),
      processing: false,
    };
    loop.donePromise = this.runLoop(loop).catch((error) => {
      this.logger.error(`Ingestion loop for channel "${channel.name}" crashed: ${error}`);
    });
    this.loops.set(channel.id, loop);
    this.logger.log(`Starting ingestion loop for channel "${channel.name}" (${channel.id})`);
  }

  private async stopLoop(loop: ChannelLoop) {
    loop.stopped = true;
    await loop.donePromise;
    this.logger.log(`Stopped ingestion loop for channel "${loop.channel.name}" (${loop.channel.id})`);
  }

  private async runLoop(loop: ChannelLoop) {
    while (!loop.stopped) {
      if (!loop.capture) {
        try {
          loop.capture = new cv.VideoCapture(this.mediaServer.restreamUrl(loop.channel.id));
        } catch (error) {
          loop.reconnectAttempts++;
          const delay = backoffMs(loop.reconnectAttempts);
          this.logger.warn(
            `Channel "${loop.channel.name}": failed to open stream (attempt ${loop.reconnectAttempts}) — retrying in ${delay / 1000}s: ${error}`,
          );
          // The stream may be missing because go2rtc restarted; restore it before the next attempt.
          this.mediaServer.requestSync();
          await sleepUnlessStopped(loop, delay);
          continue;
        }
      }

      let frame: cv.Mat | undefined;
      try {
        frame = await loop.capture.readAsync();
      } catch (error) {
        this.logger.warn(`Channel "${loop.channel.name}": read error: ${error}`);
      }

      if (!frame || frame.empty) {
        loop.consecutiveFailures++;
        if (loop.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
          this.logger.warn(`Channel "${loop.channel.name}": stream appears dropped — reconnecting`);
          loop.capture.release();
          loop.capture = undefined;
          loop.consecutiveFailures = 0;
          loop.reconnectAttempts++;
          await sleepUnlessStopped(loop, backoffMs(loop.reconnectAttempts));
        }
        continue;
      }

      loop.consecutiveFailures = 0;
      loop.reconnectAttempts = 0;
      const intervalMs = 1000 / loop.channel.recognitionFps;
      const now = Date.now();
      if (now - loop.lastProcessedAt >= intervalMs && !loop.processing) {
        loop.lastProcessedAt = now;
        const downscaled = frame.rescale(DOWNSCALE_FACTOR);
        loop.processing = true;
        this.alertPipeline
          .processFrame(loop.channel, downscaled)
          .catch((error) => this.logger.warn(`Channel "${loop.channel.name}": frame processing error: ${error}`))
          .finally(() => {
            loop.processing = false;
          });
      }
    }

    loop.capture?.release();
  }
}
