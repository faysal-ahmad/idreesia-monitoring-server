import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { VideoFeedSource } from '@prisma/client';
import { MediaServerService } from '../media-server/media-server.service';
import { PrismaService } from '../prisma/prisma.service';
import { IngestionProcessPoolService } from './ingestion-process-pool.service';

// A channel counts as online while frames keep arriving; this long without one and it's offline.
const FRAME_STALE_MS = 10_000;

// connecting: started (or restarted) and hasn't delivered a frame or failed yet.
export type ChannelHealthStatus = 'online' | 'connecting' | 'offline';

export interface ChannelHealth {
  channelId: string;
  name: string;
  status: ChannelHealthStatus;
  lastFrameAt: string | null;
}

// Decides which channels are read: one continuous loop per enabled channel, run in the ingestion
// processes (IngestionProcessPoolService, process/channel-loop.service.ts), each reading the
// channel's re-stream from the go2rtc media server (see MediaServerService) rather than the camera
// itself. There's no periodic DB polling here — channels change only through the UI and the ERP
// sync, so `reconcile()` only runs once at startup, after the sync applies changes, and whenever the
// /system/reload endpoint is called (see SystemController), which the UI hits right after any
// channel mutation.
@Injectable()
export class VideoIngestionService implements OnModuleInit {
  private readonly logger = new Logger(VideoIngestionService.name);
  // The channels being read, as of the last reconcile.
  private readonly channels = new Map<string, VideoFeedSource>();
  // Channels disabled because their camera was unreachable (see disableUnreachableChannel), keyed
  // by id, valued by disableSeq at the time. Lets a reconcile that read the DB before the disable
  // skip them.
  private readonly selfDisabled = new Map<string, number>();
  private disableSeq = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly mediaServer: MediaServerService,
    private readonly pool: IngestionProcessPoolService,
  ) {
    this.pool.onUnreachable(
      (channelId, reason) =>
        void this.disableUnreachableChannel(channelId, reason),
    );
  }

  async onModuleInit() {
    await this.reconcile();
  }

  async reconcile() {
    const seqAtRead = this.disableSeq;
    const enabledChannels = await this.prisma.videoFeedSource.findMany({
      where: { enabled: true, deletedAt: null },
    });
    // Streams first, so loops (re)opening find them. If go2rtc is unreachable, loops just keep
    // retrying and the periodic resync adds the streams once it's back.
    await this.mediaServer.sync(enabledChannels);

    const desired = enabledChannels.filter((channel) => {
      // Disabled for being unreachable after the read above, so `channel` is stale — don't restart it.
      if ((this.selfDisabled.get(channel.id) ?? 0) > seqAtRead) return false;
      this.selfDisabled.delete(channel.id);
      return true;
    });
    for (const channelId of this.channels.keys()) {
      if (!desired.some((channel) => channel.id === channelId)) {
        this.logger.log(`Stopping ingestion for channel ${channelId}`);
      }
    }
    for (const channel of desired) {
      if (!this.channels.has(channel.id)) {
        this.logger.log(
          `Starting ingestion for channel "${channel.name}" (${channel.id})`,
        );
      }
    }
    this.channels.clear();
    for (const channel of desired) this.channels.set(channel.id, channel);
    this.pool.setDesiredChannels(desired);
  }

  // One entry per channel being read, derived from how recently it delivered a frame.
  health(): ChannelHealth[] {
    const now = Date.now();
    return Array.from(this.channels.values())
      .map((channel) => {
        const report = this.pool.healthReport(channel.id);
        const lastFrameAt = report?.lastFrameAt ?? 0;
        const reconnectAttempts = report?.reconnectAttempts ?? 0;
        let status: ChannelHealthStatus = 'offline';
        if (lastFrameAt && now - lastFrameAt < FRAME_STALE_MS)
          status = 'online';
        else if (!lastFrameAt && reconnectAttempts === 0) status = 'connecting';
        return {
          channelId: channel.id,
          name: channel.name,
          status,
          lastFrameAt: lastFrameAt ? new Date(lastFrameAt).toISOString() : null,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  // Gives up on a channel whose camera can't be reached; its ingestion process has already stopped
  // reading it. A reconcile that read the DB before the update below would still see the channel
  // enabled and restart it — selfDisabled tells it not to.
  private async disableUnreachableChannel(channelId: string, reason: string) {
    const name = this.channels.get(channelId)?.name ?? channelId;
    this.logger.error(`Channel "${name}": ${reason} — disabling it`);
    let disabled = false;
    try {
      // A change here like any other, so the next sync passes it on to the ERP.
      await this.prisma.videoFeedSource.update({
        where: { id: channelId },
        data: { enabled: false },
      });
      disabled = true;
    } catch (error) {
      // Still drop the channel. It stays enabled in the DB, so it's retried on the next reconcile
      // (startup or /system/reload); until then it isn't read and has no health entry.
      this.logger.error(
        `Channel "${name}": failed to mark it disabled: ${error}`,
      );
    }
    if (disabled) this.selfDisabled.set(channelId, ++this.disableSeq);
    this.channels.delete(channelId);
    this.pool.dropChannel(channelId);
    // Drop its re-stream from go2rtc now rather than on the next periodic resync. Skipped if the
    // DB is failing — the stream is still wanted, and the sync's own DB read would reject.
    if (disabled) {
      this.mediaServer
        .syncEnabledChannels()
        .catch((error) =>
          this.logger.warn(
            `Channel "${name}": stream sync after disabling failed: ${error}`,
          ),
        );
    }
  }
}
