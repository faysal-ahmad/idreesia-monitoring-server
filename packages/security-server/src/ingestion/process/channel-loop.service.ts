import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { VideoFeedSource } from '@prisma/client';
import * as cv from '@u4/opencv4nodejs';
import {
  detectionScaleFor,
  resolveMinFaceSize,
} from '../../recognition/face-gate';
import { ChannelStatsRecorder } from '../channel-stats-recorder';
import { FramePipelineService } from './frame-pipeline.service';
import { AssignedChannel, ChannelHealthReport } from './ingestion-protocol';
import { ParentChannel } from './parent-channel';

// Frames are always read (to stay near-live and drain the stream buffer), but only handed off
// downstream at the channel's recognitionFps, to cap CPU load. Paced by time rather than by
// frame count so the rate doesn't depend on the camera's own frame rate.
const MAX_CONSECUTIVE_FAILURES = 5;
// Reconnects back off from 5s to 60s. After MAX_RECONNECT_ATTEMPTS in a row without a frame the
// channel's loop stops and the main process disables it in the DB; re-enabling it in the UI starts
// it afresh. Besides not retrying a dead camera forever, this bounds a native leak:
// @u4/opencv4nodejs's VideoCapture constructor never frees its native object when the open fails.
const RECONNECT_BACKOFF_MIN_MS = 5_000;
const RECONNECT_BACKOFF_MAX_MS = 60_000;
const MAX_RECONNECT_ATTEMPTS = 10;
// Pause before restarting a loop that crashed, so an error that recurs every frame can't spin.
const CRASH_RESTART_DELAY_MS = 5_000;
// How often the main process hears how each channel is doing (see VideoIngestionService.health).
const HEALTH_REPORT_MS = 2_000;

interface ChannelLoop {
  channel: VideoFeedSource;
  restreamUrl: string;
  stopped: boolean;
  capture?: cv.VideoCapture;
  lastProcessedAt: number;
  // When the last good frame was read, for health reporting; 0 until the first one.
  lastFrameAt: number;
  frameWidth?: number;
  frameHeight?: number;
  consecutiveFailures: number;
  // Consecutive failed (re)connects, driving the backoff; reset once frames flow again.
  reconnectAttempts: number;
  donePromise: Promise<void>;
  // Guards against overlapping detection work if it's slower than the frame-skip interval —
  // a frame is simply dropped rather than queued if the previous one is still processing.
  processing: boolean;
}

function backoffMs(attempt: number): number {
  return Math.min(
    RECONNECT_BACKOFF_MIN_MS * 2 ** Math.max(0, attempt - 1),
    RECONNECT_BACKOFF_MAX_MS,
  );
}

// Sleeps in short slices so a stopped loop (channel disabled, process shutting down) exits promptly
// instead of finishing a backoff of up to a minute first.
async function sleepUnlessStopped(
  loop: ChannelLoop,
  ms: number,
): Promise<void> {
  const until = Date.now() + ms;
  while (!loop.stopped && Date.now() < until) {
    await new Promise((resolve) =>
      setTimeout(resolve, Math.min(500, until - Date.now())),
    );
  }
}

function configsEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

// One continuous read loop per channel assigned to this ingestion process, reading the channel's
// re-stream from the go2rtc media server rather than the camera itself. The main process decides
// which channels run here (IngestionProcessPoolService) and sends the full set whenever it changes.
// Uses VideoCapture's async API (readAsync) throughout — the sync API blocks the event loop per
// frame, which would stall every other channel in this process.
@Injectable()
export class ChannelLoopService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ChannelLoopService.name);
  private readonly loops = new Map<string, ChannelLoop>();
  // Channels whose loop gave up on an unreachable camera. Not restarted while the main process
  // still lists them (it may not have handled the 'unreachable' message yet); forgotten once a
  // setChannels leaves them out, so a later re-enable starts them afresh.
  private readonly selfStopped = new Set<string>();
  private healthTimer?: NodeJS.Timeout;

  constructor(
    private readonly framePipeline: FramePipelineService,
    private readonly stats: ChannelStatsRecorder,
    private readonly parent: ParentChannel,
  ) {}

  onModuleInit() {
    this.healthTimer = setInterval(() => this.reportHealth(), HEALTH_REPORT_MS);
  }

  async onModuleDestroy() {
    clearInterval(this.healthTimer);
    await Promise.all(
      Array.from(this.loops.values()).map((loop) => this.stopLoop(loop)),
    );
  }

  async setChannels(assigned: AssignedChannel[]) {
    const assignedById = new Map(
      assigned.map((entry) => [entry.channel.id, entry]),
    );
    for (const channelId of this.selfStopped) {
      if (!assignedById.has(channelId)) this.selfStopped.delete(channelId);
    }

    const stopPromises: Promise<void>[] = [];
    for (const [channelId, loop] of this.loops) {
      if (!assignedById.has(channelId)) {
        stopPromises.push(this.stopLoop(loop));
        this.loops.delete(channelId);
      }
    }
    await Promise.all(stopPromises);

    for (const [channelId, { channel, restreamUrl }] of assignedById) {
      const existingLoop = this.loops.get(channelId);
      if (!existingLoop) {
        if (this.selfStopped.has(channelId)) continue;
        this.startLoop(channel, restreamUrl);
        continue;
      }

      // Already running — refresh the in-memory snapshot so name/similarityThreshold/recognitionFps
      // changes take effect immediately. If the connection details changed, go2rtc's stream source
      // was just updated by the main process; reconnect so the loop reads from the new camera source.
      const configChanged = !configsEqual(
        existingLoop.channel.config,
        channel.config,
      );
      existingLoop.channel = channel;
      existingLoop.restreamUrl = restreamUrl;
      if (configChanged && existingLoop.capture) {
        existingLoop.capture.release();
        existingLoop.capture = undefined;
      }
    }
    this.reportHealth();
  }

  private reportHealth() {
    const channels: ChannelHealthReport[] = Array.from(
      this.loops.values(),
      (loop) => ({
        channelId: loop.channel.id,
        lastFrameAt: loop.lastFrameAt,
        reconnectAttempts: loop.reconnectAttempts,
        frameWidth: loop.frameWidth,
        frameHeight: loop.frameHeight,
      }),
    );
    this.parent.send({ type: 'health', channels });
  }

  private startLoop(channel: VideoFeedSource, restreamUrl: string) {
    const loop: ChannelLoop = {
      channel,
      restreamUrl,
      stopped: false,
      lastProcessedAt: 0,
      lastFrameAt: 0,
      consecutiveFailures: 0,
      reconnectAttempts: 0,
      donePromise: Promise.resolve(),
      processing: false,
    };
    loop.donePromise = this.superviseLoop(loop);
    this.loops.set(channel.id, loop);
    this.logger.log(
      `Starting ingestion loop for channel "${channel.name}" (${channel.id})`,
    );
  }

  // Restarts a loop that died on an unexpected error. Otherwise the channel would sit dead until
  // the process restarts: its entry stays in `loops`, so setChannels() never starts it again.
  private async superviseLoop(loop: ChannelLoop) {
    while (!loop.stopped) {
      try {
        await this.runLoop(loop);
      } catch (error) {
        this.logger.error(
          `Ingestion loop for channel "${loop.channel.name}" crashed — restarting in ${CRASH_RESTART_DELAY_MS / 1000}s: ${error}`,
        );
        try {
          loop.capture?.release();
        } catch {
          // Already broken; dropping the reference is all that's left to do.
        }
        loop.capture = undefined;
        loop.consecutiveFailures = 0;
        await sleepUnlessStopped(loop, CRASH_RESTART_DELAY_MS);
      }
    }
  }

  private async stopLoop(loop: ChannelLoop) {
    loop.stopped = true;
    await loop.donePromise;
    this.logger.log(
      `Stopped ingestion loop for channel "${loop.channel.name}" (${loop.channel.id})`,
    );
  }

  private async runLoop(loop: ChannelLoop) {
    while (!loop.stopped) {
      if (!loop.capture) {
        try {
          loop.capture = new cv.VideoCapture(loop.restreamUrl);
        } catch (error) {
          loop.reconnectAttempts++;
          this.stats.reconnect(loop.channel.id);
          if (loop.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
            this.giveUpOnUnreachableChannel(
              loop,
              `failed to open stream: ${error}`,
            );
            break;
          }
          const delay = backoffMs(loop.reconnectAttempts);
          this.logger.warn(
            `Channel "${loop.channel.name}": failed to open stream (attempt ${loop.reconnectAttempts}) — retrying in ${delay / 1000}s: ${error}`,
          );
          // The stream may be missing because go2rtc restarted; restore it before the next attempt.
          this.parent.send({ type: 'requestStreamSync' });
          await sleepUnlessStopped(loop, delay);
          continue;
        }
      }

      let frame: cv.Mat | undefined;
      try {
        frame = await loop.capture.readAsync();
      } catch (error) {
        this.logger.warn(
          `Channel "${loop.channel.name}": read error: ${error}`,
        );
      }

      if (!frame || frame.empty) {
        frame?.release();
        this.stats.readFailure(loop.channel.id);
        loop.consecutiveFailures++;
        if (loop.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
          this.logger.warn(
            `Channel "${loop.channel.name}": stream appears dropped — reconnecting`,
          );
          loop.capture.release();
          loop.capture = undefined;
          loop.consecutiveFailures = 0;
          loop.reconnectAttempts++;
          this.stats.reconnect(loop.channel.id);
          if (loop.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
            this.giveUpOnUnreachableChannel(
              loop,
              'stream keeps dropping without delivering frames',
            );
            break;
          }
          await sleepUnlessStopped(loop, backoffMs(loop.reconnectAttempts));
        }
        continue;
      }

      loop.consecutiveFailures = 0;
      loop.reconnectAttempts = 0;
      loop.lastFrameAt = Date.now();
      loop.frameWidth = frame.cols;
      loop.frameHeight = frame.rows;
      this.stats.frameRead(loop.channel.id, frame.cols, frame.rows);
      const intervalMs = 1000 / loop.channel.recognitionFps;
      const now = Date.now();
      const due = now - loop.lastProcessedAt >= intervalMs;
      if (due && !loop.processing) {
        loop.lastProcessedAt = now;
        this.stats.frameProcessed(loop.channel.id);
        // Detection runs on a scaled-down copy (see detectionScaleFor); matching and the alert
        // snapshot use the full frame, so it's kept until processing is done. loop.processing
        // means only one frame per channel is ever held.
        const scale = detectionScaleFor(
          resolveMinFaceSize(loop.channel.minFaceSizePx),
        );
        const detectionFrame = scale < 1 ? frame.rescale(scale) : frame;
        loop.processing = true;
        this.framePipeline
          .processFrame(loop.channel, frame, detectionFrame, scale)
          .catch((error) =>
            this.logger.warn(
              `Channel "${loop.channel.name}": frame processing error: ${error}`,
            ),
          )
          .finally(() => {
            if (detectionFrame !== frame) detectionFrame.release();
            frame.release();
            loop.processing = false;
          });
      } else {
        // Due but still busy with the previous frame means recognition can't keep up.
        this.stats.frameSkipped(loop.channel.id, due ? 'busy' : 'fps');
        // Cameras deliver far more frames than are sampled for recognition. A frame left unreleased
        // is freed by a GC finalizer, and that churn (every dropped frame, on every channel) is what
        // triggers the V8 fatal error in Isolate::AdjustAmountOfExternalAllocatedMemory.
        frame.release();
      }
    }

    loop.capture?.release();
  }

  // Gives up on a channel whose camera can't be reached. Called from inside its own loop, so it
  // must not go through stopLoop (which awaits the loop's donePromise). The main process disables
  // the channel in the DB (VideoIngestionService.disableUnreachableChannel).
  private giveUpOnUnreachableChannel(loop: ChannelLoop, reason: string) {
    loop.stopped = true;
    if (this.loops.get(loop.channel.id) === loop) {
      this.loops.delete(loop.channel.id);
    }
    this.selfStopped.add(loop.channel.id);
    this.parent.send({
      type: 'unreachable',
      channelId: loop.channel.id,
      reason: `unreachable after ${loop.reconnectAttempts} attempts (${reason})`,
    });
  }
}
