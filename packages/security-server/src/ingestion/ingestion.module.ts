import { Module } from '@nestjs/common';
import { AlertModule } from '../alerts/alert.module';
import { ConfigurationModule } from '../configuration/configuration.module';
import { MediaServerModule } from '../media-server/media-server.module';
import { RecognitionModule } from '../recognition/recognition.module';
import { AlertPipelineService } from './alert-pipeline.service';
import { ChannelHealthController } from './channel-health.controller';
import { FaceMatchCacheService } from './face-match-cache.service';
import { VideoIngestionService } from './video-ingestion.service';

@Module({
  imports: [RecognitionModule, ConfigurationModule, AlertModule, MediaServerModule],
  controllers: [ChannelHealthController],
  providers: [VideoIngestionService, AlertPipelineService, FaceMatchCacheService],
  // Both are re-synced on demand rather than polled — by the ERP sync after it applies changes,
  // and by SystemController's /system/reload, which the UI calls after any channel, profile or
  // configuration change.
  exports: [FaceMatchCacheService, VideoIngestionService],
})
export class IngestionModule {}
