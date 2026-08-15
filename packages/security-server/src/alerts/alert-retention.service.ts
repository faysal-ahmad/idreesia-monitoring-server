import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConfigurationService } from '../configuration/configuration.service';
import { PrismaService } from '../prisma/prisma.service';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

@Injectable()
export class AlertRetentionService {
  private readonly logger = new Logger(AlertRetentionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configuration: ConfigurationService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async purgeExpiredAlerts() {
    const { alertsRetentionDays } = await this.configuration.get();
    const cutoff = new Date(Date.now() - alertsRetentionDays * MS_PER_DAY);

    const { count } = await this.prisma.alert.deleteMany({
      where: { timestamp: { lt: cutoff } },
    });

    if (count > 0) {
      this.logger.log(`Purged ${count} alert(s) older than ${alertsRetentionDays} day(s)`);
    }
  }
}
