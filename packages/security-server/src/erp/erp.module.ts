import { Module } from '@nestjs/common';
import { AlertModule } from '../alerts/alert.module';
import { ConfigurationModule } from '../configuration/configuration.module';
import { IngestionModule } from '../ingestion/ingestion.module';
import { MonitoringProfileModule } from '../monitoring-profiles/monitoring-profile.module';
import { ErpAlertPushService } from './erp-alert-push.service';
import { ErpClientService } from './erp-client.service';
import { ErpSyncService } from './erp-sync.service';
import { ErpSyncStateService } from './erp-sync-state.service';
import { ErpController } from './erp.controller';

// Everything that talks to the ERP: the two-way channel/profile sync and the alert push.
// Idle unless ERP_URL, ERP_USERNAME and ERP_PASSWORD are set.
@Module({
  imports: [AlertModule, ConfigurationModule, IngestionModule, MonitoringProfileModule],
  controllers: [ErpController],
  providers: [ErpClientService, ErpSyncStateService, ErpAlertPushService, ErpSyncService],
})
export class ErpModule {}
