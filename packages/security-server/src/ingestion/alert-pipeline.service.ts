import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AlertService } from '../alerts/alert.service';
import { IngestionProcessPoolService } from './ingestion-process-pool.service';
import { AlertEvent } from './process/ingestion-protocol';

// Saves the alerts the ingestion processes raise. Detection, matching, the cooldown and the
// snapshot all happen in the ingestion process (process/frame-pipeline.service.ts); the main
// process owns the database and the Alerts page's live stream, so the alert is created here.
@Injectable()
export class AlertPipelineService {
  private readonly logger = new Logger(AlertPipelineService.name);

  constructor(
    private readonly alerts: AlertService,
    pool: IngestionProcessPoolService,
  ) {
    pool.onAlert((alert) => void this.saveAlert(alert));
  }

  private async saveAlert(alert: AlertEvent) {
    try {
      const created = await this.alerts.create(
        {
          monitoringProfileId: alert.profileId,
          channelId: alert.channelId,
          similarityScore: alert.score,
          faceSizePx: alert.faceSizePx,
          faceQuality: alert.quality as unknown as Prisma.InputJsonValue,
        },
        alert.image,
      );
      this.logger.log(
        `ALERT: "${alert.profileName}" detected on channel "${created.channel?.name ?? alert.channelId}" (cosine similarity ${alert.score.toFixed(3)}, face ${alert.faceSizePx}px, quality ${alert.quality.score})`,
      );
    } catch (error) {
      this.logger.warn(
        `Failed to save alert for "${alert.profileName}" on channel ${alert.channelId}: ${error}`,
      );
    }
  }
}
