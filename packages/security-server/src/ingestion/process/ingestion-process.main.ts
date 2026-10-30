import { ConsoleLogger, Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { monitorEventLoopDelay } from 'perf_hooks';
import { ChannelStatsRecorder } from '../channel-stats-recorder';
import { ChannelLoopService } from './channel-loop.service';
import { IngestionProcessModule } from './ingestion-process.module';
import { MainToProcessMessage, ProcessStats } from './ingestion-protocol';
import { ParentChannel } from './parent-channel';
import { ProcessMatchCache } from './process-match-cache';

// Entry point of an ingestion process, forked by IngestionProcessPoolService and built as its own
// webpack entry (see webpack.config.js). OpenCV's Node binding only works from one thread per
// process, so recognition runs in parallel by running several of these, each with its own models
// and its own share of the channels.

// The main process is gone (crashed, or restarted by node --watch in development): nothing left
// to report to, and an orphan would keep reading cameras.
process.on('disconnect', () => process.exit(0));

// Same policy as main.ts: a stray error in a background callback must not take down every channel
// in this process. Native crashes can't be caught; the main process respawns the process instead.
process.on('unhandledRejection', (reason) => {
  Logger.error(
    `Unhandled promise rejection: ${reason instanceof Error ? reason.stack : reason}`,
    'Process',
  );
});
process.on('uncaughtException', (error) => {
  Logger.error(`Uncaught exception: ${error.stack ?? error}`, 'Process');
});

async function bootstrap() {
  const index = process.env.INGESTION_PROCESS_INDEX ?? '?';
  const app = await NestFactory.createApplicationContext(
    IngestionProcessModule,
    { logger: new ConsoleLogger({ prefix: `Ingestion ${index}` }) },
  );
  const channelLoops = app.get(ChannelLoopService);
  const matchCache = app.get(ProcessMatchCache);
  const stats = app.get(ChannelStatsRecorder);
  const parent = app.get(ParentChannel);

  const eventLoopDelay = monitorEventLoopDelay();
  eventLoopDelay.enable();
  let cpuAtLastCollect = process.cpuUsage();

  const collectStats = (): ProcessStats => {
    const cpu = process.cpuUsage(cpuAtLastCollect);
    cpuAtLastCollect = process.cpuUsage();
    // The histogram reports nanoseconds.
    const result: ProcessStats = {
      windows: stats.take(),
      cpuUserUs: cpu.user,
      cpuSystemUs: cpu.system,
      eventLoopLagP95Ms: eventLoopDelay.percentile(95) / 1e6,
      eventLoopLagMaxMs: eventLoopDelay.max / 1e6,
    };
    eventLoopDelay.reset();
    return result;
  };

  process.on('message', (message: MainToProcessMessage) => {
    switch (message.type) {
      case 'setChannels':
        void channelLoops.setChannels(message.channels);
        break;
      case 'setMatchCache':
        matchCache.set(message.entries);
        break;
      case 'collectStats':
        parent.send({
          type: 'stats',
          requestId: message.requestId,
          stats: collectStats(),
        });
        break;
      case 'stop':
        void app.close().finally(() => process.exit(0));
        break;
    }
  });

  parent.send({ type: 'ready' });
}

// A process that can't start (e.g. the models fail to load) exits; the main process respawns it.
bootstrap().catch((error) => {
  Logger.error(
    `Ingestion process failed to start: ${error instanceof Error ? error.stack : error}`,
    'Process',
  );
  process.exit(1);
});
