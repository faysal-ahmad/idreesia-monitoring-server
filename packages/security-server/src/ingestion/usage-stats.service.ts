import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { execFile } from 'child_process';
import { availableParallelism } from 'os';
import { IntervalHistogram, monitorEventLoopDelay } from 'perf_hooks';
import { PrismaService } from '../prisma/prisma.service';
import { ChannelWindow } from './channel-stats-recorder';
import { IngestionProcessPoolService } from './ingestion-process-pool.service';

// How loaded the server is and how much each camera contributes, to judge whether there's room for
// more cameras. Once per window it writes one ServerStats row (GPU, CPU, inference lanes) and one
// ChannelStats row per channel with any activity. The per-channel counters are kept by the
// ingestion processes (ChannelStatsRecorder) and collected here once per window, so the DB is
// touched once per window.
const DEFAULT_INTERVAL_SECONDS = 60;
const DEFAULT_RETENTION_DAYS = 7;
const GPU_SAMPLE_MS = 5_000;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

interface GpuSample {
  utilPct: number;
  memUsedMb: number;
  memTotalMb: number;
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

function averageOrNull(total: number, count: number): number | null {
  return count === 0 ? null : round(total / count);
}

// Unset, empty or invalid falls back to the default.
function nonNegativeNumberFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  const value = Number(raw);
  return raw && value >= 0 ? value : fallback;
}

// A channel only ever runs in one ingestion process, but sum rather than overwrite in case one was
// removed and re-added to another process within the window.
function mergeWindow(into: ChannelWindow, from: ChannelWindow) {
  into.frameWidth = from.frameWidth ?? into.frameWidth;
  into.frameHeight = from.frameHeight ?? into.frameHeight;
  into.framesRead += from.framesRead;
  into.framesProcessed += from.framesProcessed;
  into.skippedFps += from.skippedFps;
  into.skippedBusy += from.skippedBusy;
  into.readFailures += from.readFailures;
  into.reconnects += from.reconnects;
  into.skippedFaceSize += from.skippedFaceSize;
  into.skippedFaceQuality += from.skippedFaceQuality;
  into.detectMs += from.detectMs;
  into.detectCount += from.detectCount;
  into.embedMs += from.embedMs;
  into.embedCount += from.embedCount;
}

// One line per GPU: "utilization, memory used, memory total" (percent, MiB, MiB). Collapsed to the
// busiest GPU's utilisation and the memory summed across GPUs; null if nvidia-smi isn't there.
function sampleGpu(): Promise<GpuSample | null> {
  return new Promise((resolve) => {
    execFile(
      'nvidia-smi',
      [
        '--query-gpu=utilization.gpu,memory.used,memory.total',
        '--format=csv,noheader,nounits',
      ],
      { timeout: 3_000 },
      (error, stdout) => {
        if (error) return resolve(null);
        const gpus = stdout
          .trim()
          .split('\n')
          .map((line) => line.split(',').map((field) => Number(field.trim())))
          .filter(
            (fields) => fields.length === 3 && fields.every(Number.isFinite),
          );
        if (gpus.length === 0) return resolve(null);
        resolve({
          utilPct: Math.max(...gpus.map(([util]) => util)),
          memUsedMb: gpus.reduce((sum, [, used]) => sum + used, 0),
          memTotalMb: gpus.reduce((sum, [, , total]) => sum + total, 0),
        });
      },
    );
  });
}

@Injectable()
export class UsageStatsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(UsageStatsService.name);
  // 0 disables stats collection entirely.
  private readonly intervalSeconds = nonNegativeNumberFromEnv(
    'STATS_INTERVAL_SECONDS',
    DEFAULT_INTERVAL_SECONDS,
  );
  private readonly retentionDays = nonNegativeNumberFromEnv(
    'STATS_RETENTION_DAYS',
    DEFAULT_RETENTION_DAYS,
  );
  private readonly dnnTarget =
    process.env.OPENCV_DNN_TARGET === 'cuda' ? 'cuda' : 'cpu';
  private gpuSamples: GpuSample[] = [];
  // Stops sampling after the first failure: no nvidia-smi means no GPU, and won't change at runtime.
  private gpuAvailable = true;
  private windowStart = new Date();
  private cpuAtWindowStart = process.cpuUsage();
  private flushTimer?: NodeJS.Timeout;
  private gpuTimer?: NodeJS.Timeout;
  private eventLoopDelay?: IntervalHistogram;

  constructor(
    private readonly prisma: PrismaService,
    private readonly pool: IngestionProcessPoolService,
  ) {}

  onModuleInit() {
    if (!this.enabled) return;
    this.eventLoopDelay = monitorEventLoopDelay();
    this.eventLoopDelay.enable();
    this.windowStart = new Date();
    this.cpuAtWindowStart = process.cpuUsage();
    this.flushTimer = setInterval(
      () => void this.flush(),
      this.intervalSeconds * 1000,
    );
    this.flushTimer.unref();
    this.gpuTimer = setInterval(
      () => void this.recordGpuSample(),
      GPU_SAMPLE_MS,
    );
    this.gpuTimer.unref();
    void this.recordGpuSample();
  }

  async onModuleDestroy() {
    if (!this.enabled) return;
    clearInterval(this.flushTimer);
    clearInterval(this.gpuTimer);
    await this.flush();
    this.eventLoopDelay?.disable();
  }

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async purgeExpiredStats() {
    const where = {
      windowStart: {
        lt: new Date(Date.now() - this.retentionDays * MS_PER_DAY),
      },
    };
    try {
      const [channelRows, serverRows] = await this.prisma.$transaction([
        this.prisma.channelStats.deleteMany({ where }),
        this.prisma.serverStats.deleteMany({ where }),
      ]);
      const count = channelRows.count + serverRows.count;
      if (count > 0) {
        this.logger.log(
          `Purged ${count} stats row(s) older than ${this.retentionDays} day(s)`,
        );
      }
    } catch (error) {
      this.logger.warn(`Failed to purge old stats: ${error}`);
    }
  }

  get enabled(): boolean {
    return this.intervalSeconds > 0;
  }

  private async recordGpuSample() {
    if (!this.gpuAvailable) return;
    const sample = await sampleGpu();
    if (sample) {
      this.gpuSamples.push(sample);
    } else {
      this.gpuAvailable = false;
      this.logger.log(
        'No NVIDIA GPU visible (nvidia-smi failed); GPU stats off',
      );
    }
  }

  private async flush() {
    // Swap first, so samples taken while the collection and write are in flight land in the next window.
    const gpuSamples = this.gpuSamples;
    const windowStart = this.windowStart;
    const windowEnd = new Date();
    const cpu = process.cpuUsage(this.cpuAtWindowStart);
    this.gpuSamples = [];
    this.windowStart = windowEnd;
    this.cpuAtWindowStart = process.cpuUsage();

    const windowMs = windowEnd.getTime() - windowStart.getTime();
    if (windowMs <= 0) return;

    const processStats = await this.pool.collectStats();
    const windows = new Map<string, ChannelWindow>();
    for (const stats of processStats) {
      for (const [channelId, window] of Object.entries(stats.windows)) {
        const existing = windows.get(channelId);
        if (existing) mergeWindow(existing, window);
        else windows.set(channelId, window);
      }
    }

    const channelRows = Array.from(windows, ([channelId, window]) => ({
      windowStart,
      windowEnd,
      channelId,
      frameWidth: window.frameWidth ?? null,
      frameHeight: window.frameHeight ?? null,
      framesRead: window.framesRead,
      framesProcessed: window.framesProcessed,
      skippedFps: window.skippedFps,
      skippedBusy: window.skippedBusy,
      readFailures: window.readFailures,
      reconnects: window.reconnects,
      faces: window.embedCount,
      skippedFaceSize: window.skippedFaceSize,
      skippedFaceQuality: window.skippedFaceQuality,
      inferenceMs: round(window.detectMs + window.embedMs),
      detectAvgMs: averageOrNull(window.detectMs, window.detectCount),
      embedAvgMs: averageOrNull(window.embedMs, window.embedCount),
    }));

    // Each ingestion process is one inference lane, and frames start being skipped as soon as any
    // one lane fills, so the busiest lane is the one that matters.
    const laneInferenceMs = processStats.map((stats) =>
      Object.values(stats.windows).reduce(
        (sum, window) => sum + window.detectMs + window.embedMs,
        0,
      ),
    );
    const busiestLaneMs = laneInferenceMs.length
      ? Math.max(...laneInferenceMs)
      : 0;
    const cpuUs = processStats.reduce(
      (sum, stats) => sum + stats.cpuUserUs + stats.cpuSystemUs,
      cpu.user + cpu.system,
    );
    const gpuUtil = gpuSamples.map((sample) => sample.utilPct);
    const lastGpuSample = gpuSamples.at(-1);
    // The histogram reports nanoseconds.
    const serverRow = {
      windowStart,
      windowEnd,
      activeChannels: channelRows.filter((row) => row.framesRead > 0).length,
      dnnTarget: this.dnnTarget,
      inferenceBusyPct: round((busiestLaneMs / windowMs) * 100),
      gpuUtilAvgPct: gpuUtil.length
        ? round(gpuUtil.reduce((sum, util) => sum + util, 0) / gpuUtil.length)
        : null,
      gpuUtilMaxPct: gpuUtil.length ? Math.max(...gpuUtil) : null,
      gpuMemUsedMb: lastGpuSample?.memUsedMb ?? null,
      gpuMemTotalMb: lastGpuSample?.memTotalMb ?? null,
      // The main process and every ingestion process together.
      cpuPct: round((cpuUs / 1000 / windowMs) * 100),
      cpuCores: availableParallelism(),
      // The worst of any process: a lagging ingestion process delays its channels' frames.
      eventLoopLagP95Ms: round(
        Math.max(
          (this.eventLoopDelay?.percentile(95) ?? 0) / 1e6,
          ...processStats.map((stats) => stats.eventLoopLagP95Ms),
        ),
      ),
      eventLoopLagMaxMs: round(
        Math.max(
          (this.eventLoopDelay?.max ?? 0) / 1e6,
          ...processStats.map((stats) => stats.eventLoopLagMaxMs),
        ),
      ),
    };
    this.eventLoopDelay?.reset();

    const skippedBusy = channelRows.reduce(
      (sum, row) => sum + row.skippedBusy,
      0,
    );
    this.logger.log(
      `Usage ${Math.round(windowMs / 1000)}s: ${serverRow.activeChannels} channel(s), ` +
        `busiest of ${processStats.length}/${this.pool.size} inference lane(s) ${serverRow.inferenceBusyPct}% busy, ` +
        `skipped busy ${skippedBusy}, ` +
        `GPU ${serverRow.gpuUtilAvgPct ?? '-'}% (max ${serverRow.gpuUtilMaxPct ?? '-'}%) ` +
        `${serverRow.gpuMemUsedMb ?? '-'}/${serverRow.gpuMemTotalMb ?? '-'} MiB, ` +
        `CPU ${serverRow.cpuPct}% of ${serverRow.cpuCores} cores`,
    );

    try {
      // A channel deleted mid-window would fail the whole batch on its foreign key; drop it instead.
      const existing = await this.prisma.videoFeedSource.findMany({
        where: { id: { in: channelRows.map((row) => row.channelId) } },
        select: { id: true },
      });
      const existingIds = new Set(existing.map((channel) => channel.id));
      await this.prisma.$transaction([
        this.prisma.serverStats.create({ data: serverRow }),
        this.prisma.channelStats.createMany({
          data: channelRows.filter((row) => existingIds.has(row.channelId)),
        }),
      ]);
    } catch (error) {
      // Stats are diagnostic: losing a window must never disturb ingestion.
      this.logger.warn(`Failed to save usage stats: ${error}`);
    }
  }
}
