import {
  BadRequestException,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { MonitoringProfile, Prisma, VideoFeedSource } from '@prisma/client';
import { Subscription } from 'rxjs';
import { AlertEventsService } from '../alerts/alert-events.service';
import { AlertImageStorageService } from '../alerts/alert-image-storage.service';
import { ConfigurationService } from '../configuration/configuration.service';
import { FaceMatchCacheService } from '../ingestion/face-match-cache.service';
import { VideoIngestionService } from '../ingestion/video-ingestion.service';
import { MonitoringProfileService } from '../monitoring-profiles/monitoring-profile.service';
import { PrismaService } from '../prisma/prisma.service';
import { parseRtspConfig } from '../video-feed-sources/video-feed-source-config.schema';
import { ErpAlertPushService } from './erp-alert-push.service';
import { ErpClientService } from './erp-client.service';
import { ErpSyncStateService } from './erp-sync-state.service';
import { replaceInterval } from './replace-interval';

const SYNC_INTERVAL_NAME = 'erp-sync';

// The ERP's GET /changes (docs/security-server-sync-api.md in idreesia-erp). `id` is the ERP's id,
// `externalId` this server's id (null until the ERP has received the record).
type ChangedChannel =
  | { id: string; externalId: string | null; deleted: true }
  | {
      id: string;
      externalId: string | null;
      deleted: false;
      name: string;
      enabled: boolean;
      similarityThreshold: number | null;
      recognitionFps: number;
      connection: {
        host: string;
        port: number | null;
        path: string | null;
        username: string | null;
        password: string | null;
      };
    };

type ChangedProfile =
  | { id: string; externalId: string | null; deleted: true }
  | {
      id: string;
      externalId: string | null;
      deleted: false;
      name: string;
      isTest: boolean;
      images: { id: string; externalId: string | null }[];
    };

interface Changes {
  serverTime: string;
  channels: ChangedChannel[];
  profiles: ChangedProfile[];
}

export interface SyncSummary {
  // Applied here from the ERP.
  pulled: { channels: number; profiles: number; photos: number };
  // ERP changes not applied because the record had also changed here (this server's version wins).
  conflicts: number;
  // Sent to the ERP.
  pushed: { channels: number; profiles: number };
  // Deleted, but kept until their alerts reach the ERP.
  deferred: number;
}

// Stored the way RtspConfigSchema reads it: defaults filled in, absent credentials left out.
function toRtspConfig({
  connection,
}: Extract<ChangedChannel, { deleted: false }>): Prisma.InputJsonObject {
  return {
    host: connection.host,
    port: connection.port ?? 554,
    path: connection.path ?? '',
    ...(connection.username ? { username: connection.username } : {}),
    ...(connection.password ? { password: connection.password } : {}),
  };
}

const CONFIG_KEYS = ['host', 'port', 'path', 'username', 'password'] as const;

// Field by field: jsonb doesn't keep key order, so the stored config can't be compared as a string.
function channelDiffers(
  local: VideoFeedSource,
  remote: Extract<ChangedChannel, { deleted: false }>,
): boolean {
  const localConfig = local.config as Record<string, unknown>;
  const remoteConfig = toRtspConfig(remote);
  return (
    local.name !== remote.name ||
    local.enabled !== remote.enabled ||
    local.similarityThreshold !== remote.similarityThreshold ||
    local.recognitionFps !== remote.recognitionFps ||
    CONFIG_KEYS.some((key) => localConfig[key] !== remoteConfig[key])
  );
}

// Two-way sync of channels and profiles with the ERP. Each side keeps its own ids and stores the
// other side's as externalId (null until the other side has the record). Every run:
//  1. pulls what changed in the ERP since the last run and applies it — except to records that
//     have also changed here since then, where this server's version wins;
//  2. pushes everything that changed here since the last run, including records just pulled from
//     the ERP that it doesn't yet know by this server's id.
// "Changed here" means updatedAt after the last run started (this server's clock); the pull uses
// the ERP's own serverTime as its cursor, so the two clocks never need to agree. Records this
// sync writes keep an updatedAt at or before that point, so they don't count as local changes.
// Runs every erpSyncIntervalMinutes, and on demand from the Configuration page's Sync now.
@Injectable()
export class ErpSyncService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ErpSyncService.name);
  private readonly subscriptions: Subscription[] = [];
  // Runs one at a time, in the order requested.
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly prisma: PrismaService,
    private readonly client: ErpClientService,
    private readonly state: ErpSyncStateService,
    private readonly alertPush: ErpAlertPushService,
    private readonly profiles: MonitoringProfileService,
    private readonly videoIngestion: VideoIngestionService,
    private readonly matchCache: FaceMatchCacheService,
    private readonly events: AlertEventsService,
    private readonly images: AlertImageStorageService,
    private readonly configuration: ConfigurationService,
    private readonly scheduler: SchedulerRegistry,
  ) {}

  async onModuleInit() {
    if (!this.client.configured) {
      this.logger.warn(
        'ERP_URL, ERP_USERNAME or ERP_PASSWORD is not set: syncing with the ERP is off',
      );
      return;
    }
    this.subscriptions.push(
      this.configuration.changes$.subscribe(({ erpSyncIntervalMinutes }) =>
        this.schedule(erpSyncIntervalMinutes),
      ),
    );
    this.schedule((await this.configuration.getAll()).erpSyncIntervalMinutes);
    void this.syncInBackground();
  }

  onModuleDestroy() {
    this.subscriptions.forEach((subscription) => subscription.unsubscribe());
  }

  sync(): Promise<SyncSummary> {
    const next = this.queue.then(() => this.run());
    this.queue = next.catch(() => undefined);
    return next;
  }

  private async syncInBackground() {
    try {
      await this.sync();
    } catch (error) {
      this.logger.warn(
        `Sync with the ERP failed: ${error instanceof Error ? error.message : error}`,
      );
    }
  }

  private schedule(minutes: number) {
    replaceInterval(
      this.scheduler,
      SYNC_INTERVAL_NAME,
      minutes,
      () => void this.syncInBackground(),
    );
  }

  private async run(): Promise<SyncSummary> {
    if (!this.client.configured) {
      throw new BadRequestException('The ERP connection is not configured.');
    }
    const state = await this.state.get();
    const startedAt = new Date();
    // null on the first sync: everything here counts as changed and is pushed.
    const since = state.lastSyncStartedAt;
    const summary: SyncSummary = {
      pulled: { channels: 0, profiles: 0, photos: 0 },
      conflicts: 0,
      pushed: { channels: 0, profiles: 0 },
      deferred: 0,
    };

    try {
      const query = state.pullCursor
        ? `?since=${encodeURIComponent(state.pullCursor)}`
        : '';
      const changes = (await (
        await this.client.request('GET', `/changes${query}`)
      ).json()) as Changes;

      // Records the ERP doesn't know by this server's id yet; pushed below even if unchanged.
      const toLink = {
        channels: new Set<string>(),
        profiles: new Set<string>(),
      };
      for (const channel of changes.channels)
        await this.pullChannel(channel, since, summary, toLink.channels);
      for (const profile of changes.profiles)
        await this.pullProfile(profile, since, summary, toLink.profiles);

      await this.pushChannels(since, toLink.channels, summary);
      await this.pushProfiles(since, toLink.profiles, summary);

      const { pulled } = summary;
      if (pulled.channels + pulled.profiles + pulled.photos > 0) {
        await this.videoIngestion.reconcile();
        await this.matchCache.refresh();
      }
      await this.state.update({
        pullCursor: changes.serverTime,
        lastSyncStartedAt: startedAt,
        lastSyncedAt: new Date(),
        lastSyncError: null,
      });
      this.logSummary(summary);
      // Alerts for records the ERP has only just received can go now.
      void this.alertPush.pushPending();
      return summary;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.state.update({ lastSyncError: message });
      throw error;
    }
  }

  // ---- Pull ------------------------------------------------------------------------------------

  // Changed here since the last sync — or deleted here and not yet pushed, which always counts.
  private changedLocally(
    record: { updatedAt: Date; deletedAt: Date | null },
    since: Date | null,
  ) {
    return (
      record.deletedAt !== null || since === null || record.updatedAt > since
    );
  }

  // updatedAt for rows the pull writes: at or before the last sync's start, so they don't count
  // as changed here.
  private pulledStamp(since: Date | null) {
    return since ?? new Date(0);
  }

  // A local record by the ERP's id, or by this server's id when the ERP has it but the link wasn't
  // stored here.
  private async findLocal<T>(
    find: (where: { externalId: string } | { id: string }) => Promise<T | null>,
    remote: { id: string; externalId: string | null },
  ): Promise<T | null> {
    return (
      (await find({ externalId: remote.id })) ??
      (remote.externalId ? find({ id: remote.externalId }) : null)
    );
  }

  private async pullChannel(
    remote: ChangedChannel,
    since: Date | null,
    summary: SyncSummary,
    toLink: Set<string>,
  ) {
    const local = await this.findLocal(
      (where) => this.prisma.videoFeedSource.findFirst({ where }),
      remote,
    );
    if (local && this.changedLocally(local, since)) {
      summary.conflicts += 1;
      return;
    }
    const updatedAt = this.pulledStamp(since);

    if (remote.deleted) {
      // Handled with the push: the ERP is told (a no-op there), then it's removed with its alerts.
      if (local) {
        await this.prisma.videoFeedSource.update({
          where: { id: local.id },
          data: { deletedAt: new Date(), updatedAt },
        });
        summary.pulled.channels += 1;
      }
      return;
    }

    const data = {
      externalId: remote.id,
      name: remote.name,
      enabled: remote.enabled,
      similarityThreshold: remote.similarityThreshold,
      recognitionFps: remote.recognitionFps,
      config: toRtspConfig(remote),
      updatedAt,
    };
    let localId: string;
    if (!local) {
      localId = (await this.prisma.videoFeedSource.create({ data })).id;
      summary.pulled.channels += 1;
      this.logger.log(`Channel "${remote.name}" added from the ERP`);
    } else {
      localId = local.id;
      if (channelDiffers(local, remote) || local.externalId !== remote.id) {
        await this.prisma.videoFeedSource.update({
          where: { id: local.id },
          data,
        });
        summary.pulled.channels += 1;
        this.logger.log(`Channel "${remote.name}" updated from the ERP`);
      }
    }
    if (remote.externalId !== localId) toLink.add(localId);
  }

  private async pullProfile(
    remote: ChangedProfile,
    since: Date | null,
    summary: SyncSummary,
    toLink: Set<string>,
  ) {
    const local = await this.findLocal(
      (where) => this.prisma.monitoringProfile.findFirst({ where }),
      remote,
    );
    if (local && this.changedLocally(local, since)) {
      summary.conflicts += 1;
      return;
    }
    const updatedAt = this.pulledStamp(since);

    if (remote.deleted) {
      if (local) {
        await this.prisma.monitoringProfile.update({
          where: { id: local.id },
          data: { deletedAt: new Date(), updatedAt },
        });
        summary.pulled.profiles += 1;
      }
      return;
    }

    const data = {
      externalId: remote.id,
      name: remote.name,
      isTest: remote.isTest,
      updatedAt,
    };
    let profile: MonitoringProfile;
    if (!local) {
      profile = await this.prisma.monitoringProfile.create({ data });
      summary.pulled.profiles += 1;
      this.logger.log(`Profile "${remote.name}" added from the ERP`);
    } else if (
      local.name !== remote.name ||
      local.isTest !== remote.isTest ||
      local.externalId !== remote.id
    ) {
      profile = await this.prisma.monitoringProfile.update({
        where: { id: local.id },
        data,
      });
      summary.pulled.profiles += 1;
    } else {
      profile = local;
    }

    // The photo set is made to match the ERP's.
    const localImages = await this.prisma.monitoringProfileImage.findMany({
      where: { profileId: profile.id },
      select: { id: true, externalId: true },
    });
    const kept = new Set<string>();
    let linksMissing = remote.externalId !== profile.id;
    for (const image of remote.images) {
      const match = localImages.find(
        ({ id, externalId }) =>
          externalId === image.id || id === image.externalId,
      );
      if (match) {
        kept.add(match.id);
        if (match.externalId !== image.id) {
          await this.prisma.monitoringProfileImage.update({
            where: { id: match.id },
            data: { externalId: image.id },
          });
        }
        if (image.externalId !== match.id) linksMissing = true;
        continue;
      }
      const imageId = await this.downloadImage(profile, image.id);
      if (imageId) {
        kept.add(imageId);
        summary.pulled.photos += 1;
        linksMissing = true;
      }
    }
    const removed = localImages
      .filter(({ id }) => !kept.has(id))
      .map(({ id }) => id);
    if (removed.length > 0) {
      await this.prisma.monitoringProfileImage.deleteMany({
        where: { id: { in: removed } },
      });
      summary.pulled.photos += removed.length;
    }
    if (linksMissing) toLink.add(profile.id);
  }

  // Stored as received: the ERP checked the photo when it was uploaded there. Returns the local id.
  private async downloadImage(
    profile: MonitoringProfile,
    erpImageId: string,
  ): Promise<string | null> {
    try {
      const response = await this.client.request(
        'GET',
        `/profiles/${encodeURIComponent(profile.externalId ?? '')}/images/${encodeURIComponent(erpImageId)}`,
      );
      const jpeg = Buffer.from(await response.arrayBuffer());
      const embedded = this.profiles.computeSyncedImageEmbedding(jpeg);
      if (!embedded) {
        this.logger.warn(
          `No face found in photo ${erpImageId} of "${profile.name}"; it won't be used for matching`,
        );
      }
      return await this.profiles.insertImage(
        profile.id,
        embedded ?? { embedding: null, jpeg, quality: null },
        erpImageId,
      );
    } catch (error) {
      // Not stored, so the ERP still lists it next time; retried then.
      this.logger.warn(
        `Could not download photo ${erpImageId} of "${profile.name}": ${error}`,
      );
      return null;
    }
  }

  // ---- Push ------------------------------------------------------------------------------------

  // Changed here since the last sync, never sent, deleted here, or to be linked.
  private pushWhere(since: Date | null, toLink: Set<string>) {
    return {
      OR: [
        ...(since ? [{ updatedAt: { gt: since } }] : [{}]),
        { externalId: null },
        { deletedAt: { not: null } },
        { id: { in: [...toLink] } },
      ],
    };
  }

  private async pushChannels(
    since: Date | null,
    toLink: Set<string>,
    summary: SyncSummary,
  ) {
    const channels = await this.prisma.videoFeedSource.findMany({
      where: this.pushWhere(since, toLink),
    });
    for (const channel of channels) {
      const config = parseRtspConfig(channel.config);
      const body = channel.deletedAt
        ? { erpId: channel.externalId, deleted: true }
        : {
            erpId: channel.externalId,
            deleted: false,
            name: channel.name,
            enabled: channel.enabled,
            similarityThreshold: channel.similarityThreshold,
            recognitionFps: channel.recognitionFps,
            connection: {
              host: config.host,
              port: config.port,
              path: config.path || null,
              username: config.username || null,
              password: config.password || null,
            },
          };
      const response = await this.client.request(
        'PUT',
        `/channels/by-external-id/${encodeURIComponent(channel.id)}`,
        {
          body,
        },
      );
      const { _id } = (await response.json()) as { _id: string | null };
      summary.pushed.channels += 1;

      if (channel.deletedAt) {
        if (
          await this.removeWithAlerts(
            { channelId: channel.id },
            `channel "${channel.name}"`,
          )
        ) {
          await this.prisma.videoFeedSource.delete({
            where: { id: channel.id },
          });
        } else {
          summary.deferred += 1;
        }
      } else if (_id && _id !== channel.externalId) {
        // Not a change here: updatedAt is kept.
        await this.prisma.videoFeedSource.update({
          where: { id: channel.id },
          data: { externalId: _id, updatedAt: channel.updatedAt },
        });
      }
    }
  }

  private async pushProfiles(
    since: Date | null,
    toLink: Set<string>,
    summary: SyncSummary,
  ) {
    const profiles = await this.prisma.monitoringProfile.findMany({
      where: {
        OR: [
          ...this.pushWhere(since, toLink).OR,
          // A photo the ERP doesn't have yet (new here, or reported missing by the ERP).
          { images: { some: { externalId: null } } },
        ],
      },
    });
    for (const profile of profiles) {
      if (profile.deletedAt) {
        await this.client.request(
          'PUT',
          `/profiles/by-external-id/${encodeURIComponent(profile.id)}`,
          {
            body: { erpId: profile.externalId, deleted: true },
          },
        );
        summary.pushed.profiles += 1;
        if (
          await this.removeWithAlerts(
            { monitoringProfileId: profile.id },
            `profile "${profile.name}"`,
          )
        ) {
          // Cascades to its photos.
          await this.prisma.monitoringProfile.delete({
            where: { id: profile.id },
          });
        } else {
          summary.deferred += 1;
        }
        continue;
      }

      // Photos the ERP has are sent by id; the rest with their JPEG.
      const images = await this.prisma.$queryRaw<
        { id: string; externalId: string | null; image: Uint8Array | null }[]
      >`
        SELECT id, "externalId", CASE WHEN "externalId" IS NULL THEN image END AS image
        FROM security_server."MonitoringProfileImage"
        WHERE "profileId" = ${profile.id}
        ORDER BY "createdAt"
      `;
      const response = await this.client.request(
        'PUT',
        `/profiles/by-external-id/${encodeURIComponent(profile.id)}`,
        {
          body: {
            erpId: profile.externalId,
            deleted: false,
            name: profile.name,
            isTest: profile.isTest,
            images: images.map(({ id, externalId, image }) => ({
              localId: id,
              erpId: externalId,
              ...(image
                ? {
                    mimeType: 'image/jpeg',
                    data: Buffer.from(image).toString('base64'),
                  }
                : {}),
            })),
          },
        },
      );
      const result = (await response.json()) as {
        _id: string;
        images: { localId: string; _id: string }[];
        missingImages: string[];
      };
      summary.pushed.profiles += 1;

      if (result._id !== profile.externalId) {
        await this.prisma.monitoringProfile.update({
          where: { id: profile.id },
          data: { externalId: result._id, updatedAt: profile.updatedAt },
        });
      }
      for (const { localId, _id } of result.images) {
        if (images.find(({ id }) => id === localId)?.externalId !== _id) {
          await this.prisma.monitoringProfileImage.update({
            where: { id: localId },
            data: { externalId: _id },
          });
        }
      }
      // Sent again, with their JPEG, on the next sync.
      if (result.missingImages.length > 0) {
        await this.prisma.monitoringProfileImage.updateMany({
          where: { id: { in: result.missingImages } },
          data: { externalId: null },
        });
      }
    }
  }

  // Deletes the alerts of a removed channel or profile, with their image files — after first
  // sending any the ERP hasn't received. false (nothing deleted) while some are still pending; the
  // record stays deleted-but-kept and this is retried on the next sync.
  private async removeWithAlerts(
    where: Prisma.AlertWhereInput,
    label: string,
  ): Promise<boolean> {
    if (
      (await this.prisma.alert.count({
        where: { ...where, erpSyncStatus: 'PENDING' },
      })) > 0
    ) {
      await this.alertPush.pushPending();
      if (
        (await this.prisma.alert.count({
          where: { ...where, erpSyncStatus: 'PENDING' },
        })) > 0
      ) {
        this.logger.warn(`Keeping ${label} until its alerts reach the ERP`);
        return false;
      }
    }
    const alerts = await this.prisma.alert.findMany({
      where,
      select: { imageFile: true },
    });
    if (alerts.length > 0) {
      await this.prisma.alert.deleteMany({ where });
      await this.images.remove(alerts.map(({ imageFile }) => imageFile));
      this.events.emit({ type: 'resync' });
    }
    this.logger.log(`Removed ${label}`);
    return true;
  }

  private logSummary({ pulled, conflicts, pushed, deferred }: SyncSummary) {
    const parts = [
      pulled.channels && `${pulled.channels} channel(s) from the ERP`,
      pulled.profiles && `${pulled.profiles} profile(s) from the ERP`,
      pulled.photos && `${pulled.photos} photo change(s) from the ERP`,
      conflicts && `${conflicts} ERP change(s) overridden by local edits`,
      pushed.channels && `${pushed.channels} channel(s) to the ERP`,
      pushed.profiles && `${pushed.profiles} profile(s) to the ERP`,
      deferred && `${deferred} delete(s) waiting for alerts`,
    ].filter(Boolean);
    if (parts.length > 0)
      this.logger.log(`Synced with the ERP: ${parts.join(', ')}`);
  }
}
