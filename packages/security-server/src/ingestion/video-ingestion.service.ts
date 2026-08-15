import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { VideoFeedSource } from '@prisma/client';
import * as cv from '@u4/opencv4nodejs';
import { PrismaService } from '../prisma/prisma.service';
import { VideoCaptureService } from '../recognition/video-capture.service';
import { parseVideoFeedSourceConfig } from '../video-feed-sources/video-feed-source-config.schema';
import { AlertPipelineService } from './alert-pipeline.service';

// Frames are always read (to stay near-live and drain the stream buffer), but only handed off
// downstream every Nth frame, to cap effective FPS/CPU load for a close-up doorway feed.
const FRAME_SKIP = 3;
// Downscale factor applied to frames before handing them off downstream.
const DOWNSCALE_FACTOR = 0.5;
const MAX_CONSECUTIVE_FAILURES = 5;
// Consecutive failures to even open the source (camera unplugged, RTSP host unreachable, etc.)
// before giving up and disabling the channel, rather than retrying forever.
const MAX_OPEN_FAILURES = 5;
const RECONNECT_BACKOFF_MS = 5_000;

interface ChannelLoop {
  channel: VideoFeedSource;
  stopped: boolean;
  capture?: cv.VideoCapture;
  frameCounter: number;
  consecutiveFailures: number;
  openFailures: number;
  donePromise: Promise<void>;
  // Guards against overlapping detection work if it's slower than the frame-skip interval —
  // a frame is simply dropped rather than queued if the previous one is still processing.
  processing: boolean;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function configsEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

// Manages one continuous read loop per enabled channel. There's no periodic DB polling here —
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
    private readonly videoCapture: VideoCaptureService,
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

      // Already running — refresh the in-memory snapshot so name/similarityThreshold changes
      // take effect immediately. If the connection details themselves changed, force a
      // reconnect so the next capture open picks up the new source string.
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
      frameCounter: 0,
      consecutiveFailures: 0,
      openFailures: 0,
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

  // Called from within the loop's own runLoop() once it gives up retrying, so it removes itself
  // from `loops` directly rather than going through stopLoop() (which awaits donePromise — the
  // very promise this call is running inside of, which would deadlock).
  private async disableChannel(loop: ChannelLoop, reason: string) {
    this.logger.warn(
      `Channel "${loop.channel.name}": ${reason} after ${MAX_OPEN_FAILURES} attempts — disabling channel.`,
    );
    await this.prisma.videoFeedSource.update({ where: { id: loop.channel.id }, data: { enabled: false } });
    loop.stopped = true;
    this.loops.delete(loop.channel.id);
  }

  private async runLoop(loop: ChannelLoop) {
    while (!loop.stopped) {
      if (!loop.capture) {
        try {
          const config = parseVideoFeedSourceConfig(loop.channel.type, loop.channel.config);
          const source = this.videoCapture.buildSource(loop.channel.type, config);
          loop.capture = new cv.VideoCapture(source);
          loop.openFailures = 0;
        } catch (error) {
          loop.openFailures++;
          if (loop.openFailures >= MAX_OPEN_FAILURES) {
            await this.disableChannel(loop, 'failed to open source');
            break;
          }
          this.logger.warn(
            `Channel "${loop.channel.name}": failed to open source — retrying (${loop.openFailures}/${MAX_OPEN_FAILURES}): ${error}`,
          );
          await sleep(RECONNECT_BACKOFF_MS);
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
          await sleep(RECONNECT_BACKOFF_MS);
        }
        continue;
      }

      loop.consecutiveFailures = 0;
      loop.frameCounter++;
      if (loop.frameCounter % FRAME_SKIP === 0 && !loop.processing) {
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
