import { Module } from '@nestjs/common';
import { RecognitionModule } from '../recognition/recognition.module';
import { MonitoringProfileController } from './monitoring-profile.controller';
import { MonitoringProfileService } from './monitoring-profile.service';

@Module({
  imports: [RecognitionModule],
  controllers: [MonitoringProfileController],
  providers: [MonitoringProfileService],
})
export class MonitoringProfileModule {}
