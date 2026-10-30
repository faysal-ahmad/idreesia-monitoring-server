import { ChannelStats, ServerStats } from '@prisma/client';

// The ERP gets usage stats in 5-minute buckets rather than this server's per-minute windows. A window
// belongs to the bucket its windowStart falls in.
export const BUCKET_MINUTES = 5;
export const BUCKET_MS = BUCKET_MINUTES * 60_000;

export function floorToBucket(date: Date): Date {
  return new Date(Math.floor(date.getTime() / BUCKET_MS) * BUCKET_MS);
}

// Averages are over the bucket's windows and can be re-averaged by the ERP weighted by windowCount;
// "latest" values are from the bucket's last window.
export interface ServerBucket {
  windowCount: number;
  coveredSeconds: number;
  activeChannels: number;
  dnnTarget: string;
  inferenceBusyAvgPct: number;
  inferenceBusyMaxPct: number;
  gpuUtilAvgPct: number | null;
  gpuUtilMaxPct: number | null;
  gpuMemUsedMb: number | null;
  gpuMemTotalMb: number | null;
  cpuAvgPct: number;
  cpuCores: number;
  eventLoopLagP95Ms: number;
  eventLoopLagMaxMs: number;
}

// Counts are summed over the bucket's windows, so the ERP can derive rates and shares for any range
// the same way UsageStatsQueryService does.
export interface ChannelBucket {
  channelId: string;
  frameWidth: number | null;
  frameHeight: number | null;
  framesRead: number;
  framesProcessed: number;
  skippedFps: number;
  skippedBusy: number;
  readFailures: number;
  reconnects: number;
  faces: number;
  skippedFaceSize: number;
  skippedFaceQuality: number;
  inferenceMs: number;
}

export interface UsageBucket {
  bucketStart: string;
  server: ServerBucket | null;
  channels: ChannelBucket[];
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

function average(values: number[]): number | null {
  return values.length === 0
    ? null
    : round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function maxOrNull(values: number[]): number | null {
  return values.length === 0 ? null : Math.max(...values);
}

function maxOfNullable(a: number | null, b: number | null): number | null {
  if (a === null) return b;
  if (b === null) return a;
  return Math.max(a, b);
}

function toServerBucket(rows: ServerStats[]): ServerBucket {
  const latest = rows[rows.length - 1];
  const gpuAvg = rows.flatMap((row) =>
    row.gpuUtilAvgPct === null ? [] : [row.gpuUtilAvgPct],
  );
  const gpuMax = rows.flatMap((row) =>
    row.gpuUtilMaxPct === null ? [] : [row.gpuUtilMaxPct],
  );
  return {
    windowCount: rows.length,
    coveredSeconds: round(
      rows.reduce(
        (sum, row) =>
          sum + (row.windowEnd.getTime() - row.windowStart.getTime()) / 1000,
        0,
      ),
    ),
    activeChannels: Math.max(...rows.map((row) => row.activeChannels)),
    dnnTarget: latest.dnnTarget,
    inferenceBusyAvgPct: average(rows.map((row) => row.inferenceBusyPct)) ?? 0,
    inferenceBusyMaxPct: Math.max(...rows.map((row) => row.inferenceBusyPct)),
    gpuUtilAvgPct: average(gpuAvg),
    gpuUtilMaxPct: maxOrNull(gpuMax),
    gpuMemUsedMb: latest.gpuMemUsedMb,
    gpuMemTotalMb: latest.gpuMemTotalMb,
    cpuAvgPct: average(rows.map((row) => row.cpuPct)) ?? 0,
    cpuCores: latest.cpuCores,
    eventLoopLagP95Ms: average(rows.map((row) => row.eventLoopLagP95Ms)) ?? 0,
    eventLoopLagMaxMs: Math.max(...rows.map((row) => row.eventLoopLagMaxMs)),
  };
}

function addChannelRow(into: ChannelBucket, row: ChannelStats) {
  into.frameWidth = maxOfNullable(into.frameWidth, row.frameWidth);
  into.frameHeight = maxOfNullable(into.frameHeight, row.frameHeight);
  into.framesRead += row.framesRead;
  into.framesProcessed += row.framesProcessed;
  into.skippedFps += row.skippedFps;
  into.skippedBusy += row.skippedBusy;
  into.readFailures += row.readFailures;
  into.reconnects += row.reconnects;
  into.faces += row.faces;
  into.skippedFaceSize += row.skippedFaceSize;
  into.skippedFaceQuality += row.skippedFaceQuality;
  into.inferenceMs += row.inferenceMs;
}

function emptyChannelBucket(channelId: string): ChannelBucket {
  return {
    channelId,
    frameWidth: null,
    frameHeight: null,
    framesRead: 0,
    framesProcessed: 0,
    skippedFps: 0,
    skippedBusy: 0,
    readFailures: 0,
    reconnects: 0,
    faces: 0,
    skippedFaceSize: 0,
    skippedFaceQuality: 0,
    inferenceMs: 0,
  };
}

// Rolls per-minute windows up into 5-minute buckets, oldest first. The caller only passes windows
// from buckets that are complete.
export function toUsageBuckets(
  serverRows: ServerStats[],
  channelRows: ChannelStats[],
): UsageBucket[] {
  const buckets = new Map<
    number,
    { server: ServerStats[]; channels: Map<string, ChannelBucket> }
  >();
  const bucketFor = (windowStart: Date) => {
    const key = floorToBucket(windowStart).getTime();
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { server: [], channels: new Map() };
      buckets.set(key, bucket);
    }
    return bucket;
  };

  for (const row of serverRows) bucketFor(row.windowStart).server.push(row);
  for (const row of channelRows) {
    const { channels } = bucketFor(row.windowStart);
    let channel = channels.get(row.channelId);
    if (!channel) {
      channel = emptyChannelBucket(row.channelId);
      channels.set(row.channelId, channel);
    }
    addChannelRow(channel, row);
  }

  return Array.from(buckets)
    .sort(([a], [b]) => a - b)
    .map(([key, bucket]) => ({
      bucketStart: new Date(key).toISOString(),
      server: bucket.server.length
        ? toServerBucket(
            [...bucket.server].sort(
              (a, b) => a.windowStart.getTime() - b.windowStart.getTime(),
            ),
          )
        : null,
      channels: Array.from(bucket.channels.values(), (channel) => ({
        ...channel,
        inferenceMs: round(channel.inferenceMs),
      })),
    }));
}
