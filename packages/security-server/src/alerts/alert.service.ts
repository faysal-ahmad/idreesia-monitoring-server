import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ReviewAlertDto } from './alert.schema';

@Injectable()
export class AlertService {
  constructor(private readonly prisma: PrismaService) {}

  async list() {
    // Explicit select (not include) so the heavy `image` blob is never pulled for the list
    // view — this is an unbounded, ever-growing log, unlike the <50-profile enrollment images.
    const alerts = await this.prisma.alert.findMany({
      select: {
        id: true,
        timestamp: true,
        similarityScore: true,
        review: true,
        monitoringProfile: { select: { id: true, name: true, isTest: true } },
        channel: { select: { id: true, name: true } },
      },
      orderBy: { timestamp: 'desc' },
    });
    return alerts.map((alert) => ({
      id: alert.id,
      timestamp: alert.timestamp,
      similarityScore: alert.similarityScore,
      review: alert.review,
      profile: alert.monitoringProfile,
      channel: alert.channel,
    }));
  }

  async review(id: string, dto: ReviewAlertDto) {
    const { count } = await this.prisma.alert.updateMany({
      where: { id },
      data: { review: dto.review, reviewedAt: dto.review ? new Date() : null },
    });
    if (count === 0) throw new NotFoundException('Alert not found.');
  }

  async getImage(id: string): Promise<Buffer> {
    const alert = await this.prisma.alert.findUnique({ where: { id }, select: { image: true } });
    if (!alert) throw new NotFoundException('Alert not found.');
    return Buffer.from(alert.image);
  }
}
