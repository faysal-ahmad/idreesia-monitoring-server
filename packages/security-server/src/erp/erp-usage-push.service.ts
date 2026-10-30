import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { Subscription } from 'rxjs';
import { PrismaService } from '../prisma/prisma.service';
import { ErpClientService } from './erp-client.service';
import { ErpSyncStateService } from './erp-sync-state.service';
import {
  BUCKET_MINUTES,
  BUCKET_MS,
  floorToBucket,
  toUsageBuckets,
} from './usage-buckets';

// At most a day of buckets per request, so catching up after an outage doesn't send one huge body.
const MAX_BATCH_MS = 24 * 60 * 60 * 1000;

// Sends the usage stats to the ERP as 5-minute rollups, for its own Usage page. ErpSyncState's
// usageStatsPushedUntil is the cursor: everything before it has been stored by the ERP. The ERP upserts
// by bucket, so re-sending a bucket after a failure in the middle of a run is harmless.
@Injectable()
export class ErpUsagePushService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ErpUsagePushService.name);
  private running: Promise<void> | null = null;
  private subscription?: Subscription;

  constructor(
    private readonly prisma: PrismaService,
    private readonly client: ErpClientService,
    private readonly state: ErpSyncStateService,
  ) {}

  onModuleInit() {
    this.subscription = this.client.connectionChanges$.subscribe(
      () => void this.push(),
    );
    void this.push();
  }

  onModuleDestroy() {
    this.subscription?.unsubscribe();
  }

  @Interval(BUCKET_MS)
  scheduledPush() {
    void this.push();
  }

  // Single-flight: a call during a run just waits for it.
  push(): Promise<void> {
    if (!this.running) {
      this.running = this.run()
        .catch((error) => {
          this.logger.error(`Usage stats push failed: ${error}`);
        })
        .finally(() => {
          this.running = null;
        });
    }
    return this.running;
  }

  private async run() {
    if (!(await this.client.isConfigured())) return;

    // Windows are written in order as they end, so once a window has started in a bucket, every
    // window that started in the buckets before it is already stored: those buckets are complete.
    const [oldest, latest] = await Promise.all([
      this.prisma.serverStats.findFirst({ orderBy: { windowStart: 'asc' } }),
      this.prisma.serverStats.findFirst({ orderBy: { windowStart: 'desc' } }),
    ]);
    if (!oldest || !latest) return;
    const end = floorToBucket(latest.windowStart);

    const { usageStatsPushedUntil } = await this.state.get();
    // Rows before the cursor may have been purged meanwhile, if the ERP was unreachable for longer
    // than usageStatsRetentionDays: start from what's left.
    let start = floorToBucket(oldest.windowStart);
    if (usageStatsPushedUntil && usageStatsPushedUntil > start) {
      start = usageStatsPushedUntil;
    }

    while (start < end) {
      const batchEnd = new Date(
        Math.min(end.getTime(), start.getTime() + MAX_BATCH_MS),
      );
      const where = { windowStart: { gte: start, lt: batchEnd } };
      const [serverRows, channelRows] = await Promise.all([
        this.prisma.serverStats.findMany({ where }),
        this.prisma.channelStats.findMany({ where }),
      ]);
      const buckets = toUsageBuckets(serverRows, channelRows);
      if (buckets.length > 0) {
        try {
          await this.client.request('PUT', '/usage-stats', {
            body: { bucketMinutes: BUCKET_MINUTES, buckets },
          });
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          await this.state.update({ lastUsageStatsPushError: message });
          this.logger.warn(
            `Could not send usage stats to the ERP, will retry: ${message}`,
          );
          return;
        }
      }
      await this.state.update({
        usageStatsPushedUntil: batchEnd,
        lastUsageStatsPushError: null,
      });
      start = batchEnd;
    }
  }
}
