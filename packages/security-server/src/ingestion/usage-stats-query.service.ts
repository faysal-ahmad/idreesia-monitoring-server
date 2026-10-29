import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UsageStatsService } from './usage-stats.service';

const MS_PER_MINUTE = 60 * 1000;

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

function average(values: number[]): number | null {
  return values.length === 0
    ? null
    : round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function max(values: number[]): number | null {
  return values.length === 0 ? null : Math.max(...values);
}

function percent(part: number, whole: number): number {
  return whole === 0 ? 0 : round((part / whole) * 100);
}

// The read side of UsageStatsService: rolls the stats windows of the last few minutes or hours up into one
// summary for the Usage page. Rates and shares are over the time actually covered by windows, so a
// server that was down for part of the range doesn't look idle.
@Injectable()
export class UsageStatsQueryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stats: UsageStatsService,
  ) {}

  async summary(minutes: number) {
    const where = {
      windowStart: { gte: new Date(Date.now() - minutes * MS_PER_MINUTE) },
    };
    const [serverRows, channelGroups] = await Promise.all([
      this.prisma.serverStats.findMany({
        where,
        orderBy: { windowStart: 'asc' },
      }),
      this.prisma.channelStats.groupBy({
        by: ['channelId'],
        where,
        _sum: {
          framesRead: true,
          framesProcessed: true,
          skippedFps: true,
          skippedBusy: true,
          readFailures: true,
          reconnects: true,
          faces: true,
          inferenceMs: true,
        },
        _max: { frameWidth: true, frameHeight: true },
      }),
    ]);

    const coveredMs = serverRows.reduce(
      (sum, row) => sum + (row.windowEnd.getTime() - row.windowStart.getTime()),
      0,
    );
    const latest = serverRows.at(-1);
    const notNull = (values: (number | null)[]) =>
      values.filter((value): value is number => value !== null);

    const server = latest
      ? {
          windowCount: serverRows.length,
          activeChannels: latest.activeChannels,
          dnnTarget: latest.dnnTarget,
          inferenceBusyAvgPct: average(
            serverRows.map((row) => row.inferenceBusyPct),
          ),
          inferenceBusyMaxPct: max(
            serverRows.map((row) => row.inferenceBusyPct),
          ),
          gpuUtilAvgPct: average(
            notNull(serverRows.map((row) => row.gpuUtilAvgPct)),
          ),
          gpuUtilMaxPct: max(
            notNull(serverRows.map((row) => row.gpuUtilMaxPct)),
          ),
          gpuMemUsedMb: latest.gpuMemUsedMb,
          gpuMemTotalMb: latest.gpuMemTotalMb,
          cpuAvgPct: average(serverRows.map((row) => row.cpuPct)),
          cpuCores: latest.cpuCores,
          eventLoopLagP95Ms: average(
            serverRows.map((row) => row.eventLoopLagP95Ms),
          ),
          eventLoopLagMaxMs: max(
            serverRows.map((row) => row.eventLoopLagMaxMs),
          ),
        }
      : null;

    const channelRecords = await this.prisma.videoFeedSource.findMany({
      where: { id: { in: channelGroups.map((group) => group.channelId) } },
      select: { id: true, name: true, recognitionFps: true },
    });
    const channelsById = new Map(
      channelRecords.map((record) => [record.id, record]),
    );
    const coveredSeconds = coveredMs / 1000;
    const perSecond = (count: number) =>
      coveredSeconds === 0 ? 0 : round(count / coveredSeconds);

    const channels = channelGroups.flatMap((group) => {
      const channel = channelsById.get(group.channelId);
      if (!channel) return [];
      const framesProcessed = group._sum.framesProcessed ?? 0;
      const skippedBusy = group._sum.skippedBusy ?? 0;
      const inferenceMs = group._sum.inferenceMs ?? 0;
      return [
        {
          channelId: channel.id,
          name: channel.name,
          recognitionFps: channel.recognitionFps,
          frameWidth: group._max.frameWidth,
          frameHeight: group._max.frameHeight,
          readFps: perSecond(group._sum.framesRead ?? 0),
          processedFps: perSecond(framesProcessed),
          // Share of frames due for recognition that were dropped because the previous one was
          // still processing.
          busySkipPct: percent(skippedBusy, framesProcessed + skippedBusy),
          // This channel's slice of the server's inferenceBusyPct.
          inferenceSharePct: percent(inferenceMs, coveredMs),
          faces: group._sum.faces ?? 0,
          readFailures: group._sum.readFailures ?? 0,
          reconnects: group._sum.reconnects ?? 0,
        },
      ];
    });

    return {
      minutes,
      statsEnabled: this.stats.enabled,
      coveredSeconds: Math.round(coveredSeconds),
      server,
      channels,
    };
  }
}
