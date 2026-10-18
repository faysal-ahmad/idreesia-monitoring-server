import { Module } from '@nestjs/common';
import { ConfigurationModule } from '../configuration/configuration.module';
import { RecognitionModule } from '../recognition/recognition.module';
import { AlertPipelineService } from './alert-pipeline.service';
import { FaceMatchCacheService } from './face-match-cache.service';
import { VideoIngestionService } from './video-ingestion.service';

@Module({
  imports: [RecognitionModule, ConfigurationModule],
  providers: [VideoIngestionService, AlertPipelineService, FaceMatchCacheService],
  // Both are re-synced on demand rather than polled — see SystemController's /system/reload,
  // which the UI calls after any channel or profile/image mutation.
  exports: [FaceMatchCacheService, VideoIngestionService],
})
export class IngestionModule {}
