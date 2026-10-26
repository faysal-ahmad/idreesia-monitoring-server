import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConfigurationService } from '../configuration/configuration.service';
import { PrismaService } from '../prisma/prisma.service';
import { AlertEventsService } from './alert-events.service';
import { AlertImageStorageService } from './alert-image-storage.service';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

@Injectable()
export class AlertRetentionService {
  private readonly logger = new Logger(AlertRetentionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configuration: ConfigurationService,
    private readonly events: AlertEventsService,
    private readonly images: AlertImageStorageService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async purgeExpiredAlerts() {
    const { alertsRetentionDays } = await this.configuration.getAll();
    const cutoff = new Date(Date.now() - alertsRetentionDays * MS_PER_DAY);

    // Alerts not yet delivered to the ERP are kept until they are, however old.
    const where = { timestamp: { lt: cutoff }, erpSyncStatus: 'SENT' as const };
    // Only rows already past the cutoff match, so nothing new can slip in between these two queries.
    const expired = await this.prisma.alert.findMany({ where, select: { imageFile: true } });
    const { count } = await this.prisma.alert.deleteMany({ where });
    await this.images.remove(expired.map((alert) => alert.imageFile));

    if (count > 0) {
      this.events.emit({ type: 'resync' });
      this.logger.log(`Purged ${count} alert(s) older than ${alertsRetentionDays} day(s)`);
    }
  }
}
