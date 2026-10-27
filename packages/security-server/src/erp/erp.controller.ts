import { Controller, Get, HttpCode, Post } from '@nestjs/common';
import { ErpAlertPushService } from './erp-alert-push.service';
import { ErpClientService } from './erp-client.service';
import { ErpSyncService } from './erp-sync.service';
import { ErpSyncStateService } from './erp-sync-state.service';

@Controller('erp')
export class ErpController {
  constructor(
    private readonly client: ErpClientService,
    private readonly state: ErpSyncStateService,
    private readonly erpSync: ErpSyncService,
    private readonly alertPush: ErpAlertPushService,
  ) {}

  @Get('status')
  async status() {
    const { lastSyncedAt, lastSyncError } = await this.state.get();
    return {
      configured: this.client.configured,
      lastSyncedAt,
      lastSyncError,
      pendingAlerts: await this.alertPush.pendingCount(),
      lastPushError: this.alertPush.lastError,
    };
  }

  // The Configuration page's Sync now: runs the full two-way sync straight away.
  @Post('sync')
  @HttpCode(200)
  sync() {
    return this.erpSync.sync();
  }
}
