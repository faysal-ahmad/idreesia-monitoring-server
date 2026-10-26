import { Module } from '@nestjs/common';
import { AlertModule } from '../alerts/alert.module';
import { IngestionModule } from '../ingestion/ingestion.module';
import { RecognitionModule } from '../recognition/recognition.module';
import { EmbeddingBackfillService } from './embedding-backfill.service';
import { MonitoringProfileController } from './monitoring-profile.controller';
import { MonitoringProfileService } from './monitoring-profile.service';

@Module({
  imports: [RecognitionModule, IngestionModule, AlertModule],
  controllers: [MonitoringProfileController],
  providers: [MonitoringProfileService, EmbeddingBackfillService],
  // For the ERP sync, which embeds and stores the photos it pulls down.
  exports: [MonitoringProfileService],
})
export class MonitoringProfileModule {}
