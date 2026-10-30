import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { VideoFeedSource } from '@prisma/client';
import { ChildProcess, fork } from 'child_process';
import { join } from 'path';
import { MediaServerService } from '../media-server/media-server.service';
import {
  AlertEvent,
  AssignedChannel,
  CachedEmbedding,
  ChannelHealthReport,
  MainToProcessMessage,
  ProcessStats,
  ProcessToMainMessage,
} from './process/ingestion-protocol';

// OpenCV's Node binding only works from one thread per process, so the only way to run several
// cameras' recognition at once is several processes. This forks INGESTION_PROCESSES of them
// (process/ingestion-process.main.ts) and gives each a share of the channels; each reads, detects,
// embeds and matches for its own channels, and sends back health, stats and alerts. A native crash
// in one only takes its channels down until it's respawned.
const DEFAULT_PROCESSES = 4;
// A process that exited is replaced after this long, so one that dies on startup doesn't spin.
const RESPAWN_DELAY_MS = 5_000;
const STOP_TIMEOUT_MS = 5_000;
// A process that doesn't answer in time is left out of that stats window rather than holding it up.
const STATS_TIMEOUT_MS = 2_000;
// Frame size assumed for a channel's load until its first frame says otherwise.
const DEFAULT_FRAME_PIXELS = 1920 * 1080;

interface IngestionProcess {
  index: number;
  child?: ChildProcess;
  // Set once its models are loaded and it's listening (its 'ready' message); state is sent then.
  ready: boolean;
  channels: Map<string, AssignedChannel>;
}

function processCountFromEnv(): number {
  const value = Number(process.env.INGESTION_PROCESSES);
  return Number.isInteger(value) && value > 0 ? value : DEFAULT_PROCESSES;
}

@Injectable()
export class IngestionProcessPoolService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(IngestionProcessPoolService.name);
  private readonly processes: IngestionProcess[] = Array.from(
    { length: processCountFromEnv() },
    (_, index) => ({ index, ready: false, channels: new Map() }),
  );
  // Which process each channel runs in. A channel stays put until it's removed.
  private readonly assignments = new Map<string, IngestionProcess>();
  private readonly healthReports = new Map<string, ChannelHealthReport>();
  private matchCache: CachedEmbedding[] = [];
  private readonly pendingStats = new Map<
    number,
    (stats: ProcessStats | null) => void
  >();
  private nextStatsRequestId = 0;
  private stopping = false;
  private alertHandler?: (alert: AlertEvent) => void;
  private unreachableHandler?: (channelId: string, reason: string) => void;

  constructor(private readonly mediaServer: MediaServerService) {}

  get size(): number {
    return this.processes.length;
  }

  onModuleInit() {
    for (const ingestionProcess of this.processes) this.spawn(ingestionProcess);
    this.logger.log(`Starting ${this.size} ingestion process(es)`);
  }

  async onModuleDestroy() {
    this.stopping = true;
    await Promise.all(
      this.processes.map((ingestionProcess) => this.stop(ingestionProcess)),
    );
  }

  onAlert(handler: (alert: AlertEvent) => void) {
    this.alertHandler = handler;
  }

  onUnreachable(handler: (channelId: string, reason: string) => void) {
    this.unreachableHandler = handler;
  }

  // The channels that should be running. New ones go to the least-loaded process; removed ones are
  // stopped; the rest get the fresh snapshot (a config change makes their process reconnect).
  setDesiredChannels(channels: VideoFeedSource[]) {
    const desired = new Map(channels.map((channel) => [channel.id, channel]));
    for (const channelId of this.assignments.keys()) {
      if (!desired.has(channelId)) this.unassign(channelId);
    }
    for (const [channelId, channel] of desired) {
      const ingestionProcess =
        this.assignments.get(channelId) ?? this.leastLoaded();
      this.assignments.set(channelId, ingestionProcess);
      ingestionProcess.channels.set(channelId, {
        channel,
        restreamUrl: this.mediaServer.restreamUrl(channelId),
      });
    }
    for (const ingestionProcess of this.processes) {
      this.sendChannels(ingestionProcess);
    }
  }

  // For a channel its process already stopped (unreachable camera).
  dropChannel(channelId: string) {
    const ingestionProcess = this.assignments.get(channelId);
    this.unassign(channelId);
    if (ingestionProcess) this.sendChannels(ingestionProcess);
  }

  setMatchCache(entries: CachedEmbedding[]) {
    this.matchCache = entries;
    for (const ingestionProcess of this.processes) {
      this.send(ingestionProcess, { type: 'setMatchCache', entries });
    }
  }

  healthReport(channelId: string): ChannelHealthReport | undefined {
    return this.healthReports.get(channelId);
  }

  // Each process's stats since the last call. Processes that are down or too slow are left out.
  async collectStats(): Promise<ProcessStats[]> {
    const results = await Promise.all(
      this.processes
        .filter((ingestionProcess) => ingestionProcess.ready)
        .map(
          (ingestionProcess) =>
            new Promise<ProcessStats | null>((resolve) => {
              const requestId = this.nextStatsRequestId++;
              const timer = setTimeout(() => {
                this.pendingStats.delete(requestId);
                resolve(null);
              }, STATS_TIMEOUT_MS);
              this.pendingStats.set(requestId, (stats) => {
                clearTimeout(timer);
                this.pendingStats.delete(requestId);
                resolve(stats);
              });
              this.send(ingestionProcess, { type: 'collectStats', requestId });
            }),
        ),
    );
    return results.filter((stats): stats is ProcessStats => stats !== null);
  }

  private unassign(channelId: string) {
    this.assignments.get(channelId)?.channels.delete(channelId);
    this.assignments.delete(channelId);
    this.healthReports.delete(channelId);
  }

  // Load approximates recognition work: frames analysed per second times pixels per frame.
  private leastLoaded(): IngestionProcess {
    const load = (ingestionProcess: IngestionProcess) =>
      Array.from(ingestionProcess.channels.values()).reduce(
        (sum, { channel }) => {
          const report = this.healthReports.get(channel.id);
          const pixels =
            report?.frameWidth && report.frameHeight
              ? report.frameWidth * report.frameHeight
              : DEFAULT_FRAME_PIXELS;
          return sum + channel.recognitionFps * pixels;
        },
        0,
      );
    return this.processes.reduce((best, candidate) =>
      load(candidate) < load(best) ? candidate : best,
    );
  }

  private sendChannels(ingestionProcess: IngestionProcess) {
    this.send(ingestionProcess, {
      type: 'setChannels',
      channels: Array.from(ingestionProcess.channels.values()),
    });
  }

  // Dropped while the process isn't ready; it gets the full state when it is.
  private send(
    ingestionProcess: IngestionProcess,
    message: MainToProcessMessage,
  ) {
    if (ingestionProcess.ready && ingestionProcess.child?.connected) {
      ingestionProcess.child.send(message);
    }
  }

  private spawn(ingestionProcess: IngestionProcess) {
    const child = fork(join(__dirname, 'ingestion-process.js'), [], {
      // Advanced serialization keeps Dates and alert snapshot Buffers intact.
      serialization: 'advanced',
      env: {
        ...process.env,
        INGESTION_PROCESS_INDEX: String(ingestionProcess.index),
      },
      // In development the server runs under node --watch, which a child must not inherit.
      execArgv: process.execArgv.filter((arg) => !arg.startsWith('--watch')),
    });
    ingestionProcess.child = child;
    ingestionProcess.ready = false;

    child.on('message', (message: ProcessToMainMessage) =>
      this.handleMessage(ingestionProcess, message),
    );
    child.on('error', (error) =>
      this.logger.error(
        `Ingestion process ${ingestionProcess.index}: ${error}`,
      ),
    );
    child.on('exit', (code, signal) => {
      if (ingestionProcess.child !== child) return;
      ingestionProcess.child = undefined;
      ingestionProcess.ready = false;
      if (this.stopping) return;
      this.logger.error(
        `Ingestion process ${ingestionProcess.index} exited (${signal ?? `code ${code}`}) — ` +
          `its ${ingestionProcess.channels.size} channel(s) are down; restarting it in ${RESPAWN_DELAY_MS / 1000}s`,
      );
      setTimeout(() => {
        if (!this.stopping) this.spawn(ingestionProcess);
      }, RESPAWN_DELAY_MS);
    });
  }

  private handleMessage(
    ingestionProcess: IngestionProcess,
    message: ProcessToMainMessage,
  ) {
    switch (message.type) {
      case 'ready':
        ingestionProcess.ready = true;
        this.logger.log(
          `Ingestion process ${ingestionProcess.index} ready (pid ${ingestionProcess.child?.pid})`,
        );
        this.send(ingestionProcess, {
          type: 'setMatchCache',
          entries: this.matchCache,
        });
        this.sendChannels(ingestionProcess);
        break;
      case 'health':
        for (const report of message.channels) {
          // Ignore reports for channels moved away or removed since they were sent.
          if (this.assignments.get(report.channelId) === ingestionProcess) {
            this.healthReports.set(report.channelId, report);
          }
        }
        break;
      case 'alert':
        this.alertHandler?.(message.alert);
        break;
      case 'unreachable':
        this.unreachableHandler?.(message.channelId, message.reason);
        break;
      case 'requestStreamSync':
        this.mediaServer.requestSync();
        break;
      case 'stats':
        this.pendingStats.get(message.requestId)?.(message.stats);
        break;
    }
  }

  private stop(ingestionProcess: IngestionProcess): Promise<void> {
    const child = ingestionProcess.child;
    if (!child) return Promise.resolve();
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        resolve();
      }, STOP_TIMEOUT_MS);
      child.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
      if (child.connected) child.send({ type: 'stop' });
      else child.kill();
    });
  }
}
