import { Module } from '@nestjs/common';
import { AlertModule } from '../alerts/alert.module';
import { ConfigurationModule } from '../configuration/configuration.module';
import { IngestionModule } from '../ingestion/ingestion.module';
import { MonitoringProfileModule } from '../monitoring-profiles/monitoring-profile.module';
import { ErpAlertPushService } from './erp-alert-push.service';
import { ErpClientService } from './erp-client.service';
import { ErpSyncService } from './erp-sync.service';
import { ErpSyncStateService } from './erp-sync-state.service';
import { ErpUsagePushService } from './erp-usage-push.service';
import { ErpController } from './erp.controller';

// Everything that talks to the ERP: the two-way channel/profile sync, the alert push and the
// usage stats push.
// Idle until the ERP URL, username and password are set on the Configuration page.
@Module({
  imports: [
    AlertModule,
    ConfigurationModule,
    IngestionModule,
    MonitoringProfileModule,
  ],
  controllers: [ErpController],
  providers: [
    ErpClientService,
    ErpSyncStateService,
    ErpAlertPushService,
    ErpSyncService,
    ErpUsagePushService,
  ],
})
export class ErpModule {}
