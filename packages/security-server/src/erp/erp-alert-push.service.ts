import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { filter, Subscription } from 'rxjs';
import { AlertEventsService } from '../alerts/alert-events.service';
import { AlertImageStorageService } from '../alerts/alert-image-storage.service';
import { ConfigurationService } from '../configuration/configuration.service';
import { PrismaService } from '../prisma/prisma.service';
import { ErpClientService, ErpRequestError } from './erp-client.service';
import { replaceInterval } from './replace-interval';

const RETRY_INTERVAL_NAME = 'erp-alert-retry';

type PushResult = 'sent' | 'rejected' | 'unreachable';

// Delivers alerts to the ERP through an outbox: every alert starts PENDING and becomes SENT once
// the ERP has stored it. A new alert is sent as soon as it's raised; anything still pending
// (the ERP was unreachable) is retried every erpAlertRetryIntervalMinutes.
@Injectable()
export class ErpAlertPushService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ErpAlertPushService.name);
  private readonly subscriptions: Subscription[] = [];
  private running: Promise<void> | null = null;
  private runAgain = false;
  // Why the last run stopped early, until a run gets through everything again.
  lastError: string | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly client: ErpClientService,
    private readonly events: AlertEventsService,
    private readonly images: AlertImageStorageService,
    private readonly configuration: ConfigurationService,
    private readonly scheduler: SchedulerRegistry,
  ) {}

  async onModuleInit() {
    if (!this.client.configured) return;
    this.subscriptions.push(
      this.events.events$.pipe(filter((event) => event.type === 'created')).subscribe(() => void this.pushPending()),
      this.configuration.changes$.subscribe(({ erpAlertRetryIntervalMinutes }) =>
        this.schedule(erpAlertRetryIntervalMinutes),
      ),
    );
    this.schedule((await this.configuration.getAll()).erpAlertRetryIntervalMinutes);
    void this.pushPending();
  }

  onModuleDestroy() {
    this.subscriptions.forEach((subscription) => subscription.unsubscribe());
  }

  // Single-flight. A call during a run triggers one more run after it, so an alert raised
  // meanwhile doesn't wait for the retry interval.
  pushPending(): Promise<void> {
    if (this.running) {
      this.runAgain = true;
      return this.running;
    }
    this.running = this.run()
      .catch((error) => {
        this.logger.error(`Alert push failed: ${error}`);
      })
      .finally(() => {
        this.running = null;
        if (this.runAgain) {
          this.runAgain = false;
          void this.pushPending();
        }
      });
    return this.running;
  }

  pendingCount(): Promise<number> {
    return this.prisma.alert.count({ where: { erpSyncStatus: 'PENDING' } });
  }

  private schedule(minutes: number) {
    replaceInterval(this.scheduler, RETRY_INTERVAL_NAME, minutes, () => void this.pushPending());
  }

  private async run() {
    if (!this.client.configured) return;

    const pending = await this.prisma.alert.findMany({
      where: { erpSyncStatus: 'PENDING' },
      orderBy: { timestamp: 'asc' },
      select: { id: true },
    });
    for (const { id } of pending) {
      if ((await this.push(id)) === 'unreachable') return;
    }
    this.lastError = null;
  }

  private async push(id: string): Promise<PushResult> {
    const alert = await this.prisma.alert.findUnique({ where: { id } });
    // Deleted meanwhile (retention purge or a profile/channel removed by the sync).
    if (!alert || alert.erpSyncStatus !== 'PENDING') return 'sent';

    const image = await this.images.read(alert.imageFile);
    try {
      await this.client.request('PUT', `/alerts/${encodeURIComponent(alert.id)}`, {
        body: {
          profileId: alert.monitoringProfileId,
          channelId: alert.channelId,
          timestamp: alert.timestamp.toISOString(),
          similarityScore: alert.similarityScore,
          image: image ? { mimeType: 'image/jpeg', data: image.toString('base64') } : null,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // The ERP refused this alert itself — its profile or channel hasn't been synced to the ERP yet,
      // or its image file is missing: keep it pending with the reason and carry on with the rest,
      // rather than holding up every later alert. It's retried after the next sync.
      if (error instanceof ErpRequestError && (error.status === 400 || error.status === 422)) {
        await this.prisma.alert.updateMany({ where: { id }, data: { erpSyncError: message } });
        this.logger.warn(`Alert ${id} was not accepted by the ERP: ${message}`);
        return 'rejected';
      }
      this.lastError = message;
      this.logger.warn(`Could not send alerts to the ERP, will retry: ${message}`);
      return 'unreachable';
    }

    await this.prisma.alert.updateMany({ where: { id }, data: { erpSyncStatus: 'SENT', erpSyncError: null } });
    return 'sent';
  }
}
