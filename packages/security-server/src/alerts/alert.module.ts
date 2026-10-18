import { Module } from '@nestjs/common';
import { ConfigurationModule } from '../configuration/configuration.module';
import { AlertEventsService } from './alert-events.service';
import { AlertImageStorageService } from './alert-image-storage.service';
import { AlertImageController } from './alert-image.controller';
import { AlertRetentionService } from './alert-retention.service';
import { AlertController } from './alert.controller';
import { AlertService } from './alert.service';

@Module({
  imports: [ConfigurationModule],
  controllers: [AlertController, AlertImageController],
  providers: [AlertService, AlertRetentionService, AlertEventsService, AlertImageStorageService],
  // AlertService for the pipeline that creates alerts; AlertEventsService and
  // AlertImageStorageService for other code that removes alerts in bulk (resync + file cleanup).
  exports: [AlertService, AlertEventsService, AlertImageStorageService],
})
export class AlertModule {}
