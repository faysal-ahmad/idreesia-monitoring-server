import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AlertEventsService } from './alert-events.service';
import { AlertImageStorageService } from './alert-image-storage.service';
import { ListAlertsQuery } from './alert.schema';

const ALERT_LIST_SELECT = {
  id: true,
  imageFile: true,
  timestamp: true,
  similarityScore: true,
  monitoringProfile: { select: { id: true, name: true, isTest: true } },
  channel: { select: { id: true, name: true } },
} satisfies Prisma.AlertSelect;

function toListItem(alert: Prisma.AlertGetPayload<{ select: typeof ALERT_LIST_SELECT }>) {
  return {
    id: alert.id,
    imageFile: alert.imageFile,
    timestamp: alert.timestamp,
    similarityScore: alert.similarityScore,
    profile: alert.monitoringProfile,
    channel: alert.channel,
  };
}

export type AlertListItem = ReturnType<typeof toListItem>;

@Injectable()
export class AlertService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: AlertEventsService,
    private readonly images: AlertImageStorageService,
  ) {}

  // One page of the (newest-first) alert log, filtered on the server so the client only ever
  // receives the rows it shows.
  async list(query: ListAlertsQuery) {
    const where: Prisma.AlertWhereInput = {
      monitoringProfileId: query.profileId,
      channelId: query.channelId,
      timestamp: { gte: query.from, lte: query.to },
      ...(query.hideTestProfiles && { monitoringProfile: { isTest: false } }),
    };
    const [total, alerts] = await this.prisma.$transaction([
      this.prisma.alert.count({ where }),
      this.prisma.alert.findMany({
        where,
        select: ALERT_LIST_SELECT,
        orderBy: { timestamp: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return { data: alerts.map(toListItem), total };
  }

  // People and channels that appear in the alert log, for the Alerts page's filter dropdowns.
  async filterOptions() {
    const [profiles, channels] = await Promise.all([
      this.prisma.monitoringProfile.findMany({
        where: { alerts: { some: {} } },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      }),
      this.prisma.videoFeedSource.findMany({
        where: { alerts: { some: {} } },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      }),
    ]);
    return { profiles, channels };
  }

  // The frame is written to disk first; if the row can't be created, the file is removed again.
  async create(data: Omit<Prisma.AlertUncheckedCreateInput, 'imageFile'>, image: Uint8Array) {
    const imageFile = await this.images.save(image);
    let created;
    try {
      created = await this.prisma.alert.create({ data: { ...data, imageFile }, select: ALERT_LIST_SELECT });
    } catch (error) {
      await this.images.remove([imageFile]);
      throw error;
    }
    const alert = toListItem(created);
    this.events.emit({ type: 'created', alert });
    return alert;
  }
}
