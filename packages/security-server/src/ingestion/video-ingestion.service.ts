import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { VideoFeedSource } from '@prisma/client';
import * as cv from '@u4/opencv4nodejs';
import { MediaServerService } from '../media-server/media-server.service';
import { PrismaService } from '../prisma/prisma.service';
import { SystemLogService } from '../system-logs/system-log.service';
import { AlertPipelineService } from './alert-pipeline.service';

// Frames are always read (to stay near-live and drain the stream buffer), but only handed off
// downstream at the channel's recognitionFps, to cap CPU load. Paced by time rather than by
// frame count so the rate doesn't depend on the camera's own frame rate.
// Downscale factor applied to frames before handing them off downstream.
const DOWNSCALE_FACTOR = 0.5;
const MAX_CONSECUTIVE_FAILURES = 5;
// Reconnects back off from 5s to 60s. After MAX_RECONNECT_ATTEMPTS in a row without a frame the
// channel is disabled in the DB and its loop stops; re-enabling it in the UI starts it afresh.
// Besides not retrying a dead camera forever, this bounds a native leak: @u4/opencv4nodejs's
// VideoCapture constructor never frees its native object when the open fails.
const RECONNECT_BACKOFF_MIN_MS = 5_000;
const RECONNECT_BACKOFF_MAX_MS = 60_000;
const MAX_RECONNECT_ATTEMPTS = 10;
// A channel counts as online while frames keep arriving; this long without one and it's offline.
const FRAME_STALE_MS = 10_000;

// connecting: started (or restarted) and hasn't delivered a frame or failed yet.
export type ChannelHealthStatus = 'online' | 'connecting' | 'offline';

export interface ChannelHealth {
  channelId: string;
  name: string;
  status: ChannelHealthStatus;
  lastFrameAt: string | null;
}

interface ChannelLoop {
  channel: VideoFeedSource;
  stopped: boolean;
  capture?: cv.VideoCapture;
  lastProcessedAt: number;
  // When the last good frame was read, for health reporting; 0 until the first one.
  lastFrameAt: number;
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
  // Channels a loop disabled itself (see disableUnreachableChannel), keyed by id, valued by
  // disableSeq at the time. Lets a reconcile that read the DB before the disable skip them.
  private readonly selfDisabled = new Map<string, number>();
  private disableSeq = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly mediaServer: MediaServerService,
    private readonly alertPipeline: AlertPipelineService,
    private readonly systemLog: SystemLogService,
  ) {}

  async onModuleInit() {
    await this.reconcile();
  }

  async onModuleDestroy() {
    await Promise.all(Array.from(this.loops.values()).map((loop) => this.stopLoop(loop)));
  }

  async reconcile() {
    const seqAtRead = this.disableSeq;
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
        // Disabled by its own loop after the read above, so `channel` is stale — don't restart it.
        if ((this.selfDisabled.get(channelId) ?? 0) > seqAtRead) continue;
        this.selfDisabled.delete(channelId);
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

  // One entry per enabled channel (each has a loop), derived from how recently it delivered a frame.
  health(): ChannelHealth[] {
    const now = Date.now();
    return Array.from(this.loops.values())
      .map(({ channel, lastFrameAt, reconnectAttempts }) => {
        let status: ChannelHealthStatus = 'offline';
        if (lastFrameAt && now - lastFrameAt < FRAME_STALE_MS) status = 'online';
        else if (!lastFrameAt && reconnectAttempts === 0) status = 'connecting';
        return {
          channelId: channel.id,
          name: channel.name,
          status,
          lastFrameAt: lastFrameAt ? new Date(lastFrameAt).toISOString() : null,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  private startLoop(channel: VideoFeedSource) {
    const loop: ChannelLoop = {
      channel,
      stopped: false,
      lastProcessedAt: 0,
      lastFrameAt: 0,
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
          if (loop.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
            await this.disableUnreachableChannel(loop, `failed to open stream: ${error}`);
            break;
          }
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
          if (loop.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
            await this.disableUnreachableChannel(loop, 'stream keeps dropping without delivering frames');
            break;
          }
          await sleepUnlessStopped(loop, backoffMs(loop.reconnectAttempts));
        }
        continue;
      }

      loop.consecutiveFailures = 0;
      loop.reconnectAttempts = 0;
      loop.lastFrameAt = Date.now();
      const intervalMs = 1000 / loop.channel.recognitionFps;
      const now = Date.now();
      if (now - loop.lastProcessedAt >= intervalMs && !loop.processing) {
        loop.lastProcessedAt = now;
        const downscaled = frame.rescale(DOWNSCALE_FACTOR);
        // Free the full-resolution buffer now rather than leaving it to GC.
        frame.release();
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

  // Gives up on a channel whose camera can't be reached. Called from inside its own loop, so it
  // must not go through stopLoop (which awaits the loop's donePromise). A reconcile that read the
  // DB before the update below would still see the channel enabled and, finding no loop, restart
  // it — selfDisabled tells it not to.
  private async disableUnreachableChannel(loop: ChannelLoop, reason: string) {
    const { channel } = loop;
    this.logger.error(
      `Channel "${channel.name}": unreachable after ${loop.reconnectAttempts} attempts (${reason}) — disabling it`,
    );
    loop.stopped = true;
    let disabled = false;
    try {
      // A SYSTEM entry, so the log tells this apart from an admin disabling the channel.
      await this.prisma.$transaction(async (tx) => {
        await tx.videoFeedSource.update({ where: { id: channel.id }, data: { enabled: false } });
        await this.systemLog.record(
          {
            event: 'CHANNEL_DISABLED',
            source: 'SYSTEM',
            channel,
            message: `Disabled automatically: camera unreachable after ${loop.reconnectAttempts} attempts (${reason})`,
          },
          tx,
        );
      });
      disabled = true;
    } catch (error) {
      // Still stop the loop. The channel stays enabled in the DB, so it's retried on the next
      // reconcile (startup or /system/reload); until then it has no loop and no health entry.
      this.logger.error(`Channel "${channel.name}": failed to mark it disabled: ${error}`);
    }
    if (disabled) this.selfDisabled.set(channel.id, ++this.disableSeq);
    if (this.loops.get(channel.id) === loop) this.loops.delete(channel.id);
    // Drop its re-stream from go2rtc now rather than on the next periodic resync. Skipped if the
    // DB is failing — the stream is still wanted, and the sync's own DB read would reject.
    if (disabled) {
      this.mediaServer
        .syncEnabledChannels()
        .catch((error) => this.logger.warn(`Channel "${channel.name}": stream sync after disabling failed: ${error}`));
    }
  }
}
