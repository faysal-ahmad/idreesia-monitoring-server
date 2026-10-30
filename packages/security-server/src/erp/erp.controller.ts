import { Controller, Get, HttpCode, Post } from '@nestjs/common';
import { ErpAlertPushService } from './erp-alert-push.service';
import { ErpClientService } from './erp-client.service';
import { ErpSyncService } from './erp-sync.service';
import { ErpSyncStateService } from './erp-sync-state.service';
import { ErpUsagePushService } from './erp-usage-push.service';

@Controller('erp')
export class ErpController {
  constructor(
    private readonly client: ErpClientService,
    private readonly state: ErpSyncStateService,
    private readonly erpSync: ErpSyncService,
    private readonly alertPush: ErpAlertPushService,
    private readonly usagePush: ErpUsagePushService,
  ) {}

  @Get('status')
  async status() {
    const {
      lastSyncedAt,
      lastSyncError,
      usageStatsPushedUntil,
      lastUsageStatsPushError,
    } = await this.state.get();
    return {
      configured: await this.client.isConfigured(),
      lastSyncedAt,
      lastSyncError,
      pendingAlerts: await this.alertPush.pendingCount(),
      lastPushError: this.alertPush.lastError,
      usageStatsPushedUntil,
      lastUsageStatsPushError,
    };
  }

  // The Configuration page's Sync now: runs the full two-way sync straight away, and sends any
  // usage stats the ERP hasn't got yet in the background.
  @Post('sync')
  @HttpCode(200)
  sync() {
    void this.usagePush.push();
    return this.erpSync.sync();
  }
}
