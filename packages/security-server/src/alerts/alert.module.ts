import { Module } from '@nestjs/common';
import { ConfigurationModule } from '../configuration/configuration.module';
import { AlertRetentionService } from './alert-retention.service';
import { AlertController } from './alert.controller';
import { AlertService } from './alert.service';

@Module({
  imports: [ConfigurationModule],
  controllers: [AlertController],
  providers: [AlertService, AlertRetentionService],
})
export class AlertModule {}
