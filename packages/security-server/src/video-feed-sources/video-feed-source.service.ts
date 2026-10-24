import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, VideoFeedSource } from '@prisma/client';
import { parsePgVector } from '../common/pgvector.util';
import { MediaServerService } from '../media-server/media-server.service';
import { PrismaService } from '../prisma/prisma.service';
import { FaceDetectionService } from '../recognition/face-detection.service';
import { FaceRecognitionService } from '../recognition/face-recognition.service';
import { VideoCaptureService } from '../recognition/video-capture.service';
import { SystemLogService } from '../system-logs/system-log.service';
import {
  mergeStoredCredentials,
  parseRtspConfig,
  redactConfig,
  RtspConfigSchema,
} from './video-feed-source-config.schema';
import { CreateVideoFeedSourceDto, UpdateVideoFeedSourceDto, VerifyVideoFeedSourceDto } from './video-feed-source.schema';

// What an edit actually changed, for its system log entry. The edit form sends every field on each
// save, so unchanged ones are filtered out here. Credential values are never logged, only that
// they changed.
function describeChanges(before: VideoFeedSource, after: VideoFeedSource): string[] {
  const changes: string[] = [];
  if (before.name !== after.name) changes.push(`name "${before.name}" → "${after.name}"`);
  const beforeConfig = parseRtspConfig(before.config);
  const afterConfig = parseRtspConfig(after.config);
  for (const key of ['host', 'port', 'path'] as const) {
    if (beforeConfig[key] !== afterConfig[key]) {
      changes.push(`${key} "${beforeConfig[key]}" → "${afterConfig[key]}"`);
    }
  }
  if (
    (beforeConfig.username || '') !== (afterConfig.username || '') ||
    (beforeConfig.password || '') !== (afterConfig.password || '')
  ) {
    changes.push('credentials');
  }
  if (before.similarityThreshold !== after.similarityThreshold) {
    const format = (value: number | null) => (value === null ? 'default' : value.toFixed(2));
    changes.push(
      `similarity threshold ${format(before.similarityThreshold)} → ${format(after.similarityThreshold)}`,
    );
  }
  if (before.recognitionFps !== after.recognitionFps) {
    changes.push(`recognition FPS ${before.recognitionFps} → ${after.recognitionFps}`);
  }
  return changes;
}

interface TestMatchImageRow {
  profileId: string;
  profileName: string;
  embedding: string;
}

@Injectable()
export class VideoFeedSourceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly videoCapture: VideoCaptureService,
    private readonly faceDetection: FaceDetectionService,
    private readonly faceRecognition: FaceRecognitionService,
    private readonly mediaServer: MediaServerService,
    private readonly systemLog: SystemLogService,
  ) {}

  private serialize(source: VideoFeedSource) {
    return { ...source, config: redactConfig(source.config as Record<string, unknown>) };
  }

  async list() {
    const sources = await this.prisma.videoFeedSource.findMany({
      include: { _count: { select: { alerts: true } } },
      orderBy: { createdAt: 'asc' },
    });
    return sources.map((source) => {
      const { _count, ...rest } = source;
      return { ...this.serialize(rest as VideoFeedSource), alertCount: _count.alerts };
    });
  }

  async findOne(id: string) {
    return this.serialize(await this.findRaw(id));
  }

  private async findRaw(id: string): Promise<VideoFeedSource> {
    const source = await this.prisma.videoFeedSource.findUnique({ where: { id } });
    if (!source) throw new NotFoundException('Video feed source not found.');
    return source;
  }

  // Create/update/remove are only reached through the admin UI, so their log entries are ADMIN ones.
  async create(dto: CreateVideoFeedSourceDto) {
    const created = await this.prisma.$transaction(async (tx) => {
      const created = await tx.videoFeedSource.create({
        data: {
          name: dto.name,
          config: dto.config,
          enabled: dto.enabled ?? true,
        },
      });
      const { host, port, path } = dto.config;
      await this.systemLog.record(
        {
          event: 'CHANNEL_CREATED',
          source: 'ADMIN',
          channel: created,
          message: `Created (${host}:${port}${path ? `/${path.replace(/^\//, '')}` : ''}, ${created.enabled ? 'enabled' : 'disabled'})`,
        },
        tx,
      );
      return created;
    });
    return this.serialize(created);
  }

  async update(id: string, dto: UpdateVideoFeedSourceDto) {
    const existing = await this.findRaw(id);
    const config = dto.config
      ? parseRtspConfig(mergeStoredCredentials(existing.config as Record<string, unknown>, dto.config))
      : (existing.config as Record<string, unknown>);

    const updated = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.videoFeedSource.update({
        where: { id },
        data: {
          name: dto.name ?? existing.name,
          config: config as Prisma.InputJsonValue,
          enabled: dto.enabled ?? existing.enabled,
          similarityThreshold:
            dto.similarityThreshold === undefined ? existing.similarityThreshold : dto.similarityThreshold,
          recognitionFps: dto.recognitionFps ?? existing.recognitionFps,
        },
      });
      // A save that changes both settings and the enabled flag gets two entries, so enabling and
      // disabling always show up as events of their own.
      const changes = describeChanges(existing, updated);
      if (changes.length > 0) {
        await this.systemLog.record(
          { event: 'CHANNEL_UPDATED', source: 'ADMIN', channel: updated, message: `Edited: ${changes.join('; ')}` },
          tx,
        );
      }
      if (updated.enabled !== existing.enabled) {
        await this.systemLog.record(
          {
            event: updated.enabled ? 'CHANNEL_ENABLED' : 'CHANNEL_DISABLED',
            source: 'ADMIN',
            channel: updated,
            message: updated.enabled ? 'Enabled by an admin' : 'Disabled by an admin',
          },
          tx,
        );
      }
      return updated;
    });
    return this.serialize(updated);
  }

  async remove(id: string) {
    const existing = await this.findRaw(id);
    // Checked up front: the Alert FK (onDelete: Restrict) would block it anyway, but through the pg
    // driver adapter that surfaces as an untyped error the PrismaExceptionFilter can't map to a 409.
    if ((await this.prisma.alert.count({ where: { channelId: id } })) > 0) {
      throw new ConflictException('This channel has alert history and cannot be deleted.');
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.videoFeedSource.delete({ where: { id } });
      await this.systemLog.record({ event: 'CHANNEL_DELETED', source: 'ADMIN', channel: existing, message: 'Deleted' }, tx);
    });
  }

  async verify(dto: VerifyVideoFeedSourceDto) {
    const incoming = dto.channelId
      ? mergeStoredCredentials((await this.findRaw(dto.channelId)).config as Record<string, unknown>, dto.config)
      : dto.config;
    const parsed = RtspConfigSchema.safeParse(incoming);
    if (!parsed.success) {
      throw new BadRequestException('The connection details are incomplete or invalid.');
    }
    const result = this.videoCapture.captureFrame(this.videoCapture.buildRtspUrl(parsed.data));
    return result.reachable ? { reachable: true } : { reachable: false, error: result.error };
  }

  async testMatch(id: string) {
    const source = await this.findRaw(id);
    // An enabled channel is read through its go2rtc re-stream, so test-matching doesn't open an
    // extra connection to the camera; a disabled one has no re-stream, so the camera is used directly.
    const captureResult = this.videoCapture.captureFrame(
      source.enabled
        ? this.mediaServer.restreamUrl(source.id)
        : this.videoCapture.buildRtspUrl(parseRtspConfig(source.config)),
    );
    if (!captureResult.reachable || !captureResult.frame) {
      throw new BadRequestException(captureResult.error ?? 'Could not capture a frame from this channel.');
    }

    const faces = this.faceDetection.detect(captureResult.frame);
    if (faces.length === 0) {
      throw new BadRequestException('No face detected in the captured frame.');
    }
    const face = faces.reduce((best, current) => (current.confidence > best.confidence ? current : best));
    const aligned = this.faceRecognition.align(captureResult.frame, face.landmarks);
    const embedding = this.faceRecognition.embed(aligned);

    // Test-match calibration only ever compares against isTest profiles — real watch-list
    // profiles are never in scope here, and this can never produce an Alert row.
    const testImages = await this.prisma.$queryRaw<TestMatchImageRow[]>`
      SELECT mpi."profileId" as "profileId", mp.name as "profileName", mpi.embedding::text as embedding
      FROM security_server."MonitoringProfileImage" mpi
      JOIN security_server."MonitoringProfile" mp ON mp.id = mpi."profileId"
      WHERE mp."isTest" = true
    `;

    const bestScoreByProfile = new Map<string, { profileId: string; profileName: string; score: number }>();
    for (const row of testImages) {
      const storedEmbedding = parsePgVector(row.embedding);
      const score = this.faceRecognition.cosineSimilarity(embedding, storedEmbedding);
      const existing = bestScoreByProfile.get(row.profileId);
      if (!existing || score > existing.score) {
        bestScoreByProfile.set(row.profileId, { profileId: row.profileId, profileName: row.profileName, score });
      }
    }

    return {
      detectedFaceConfidence: face.confidence,
      currentSimilarityThreshold: source.similarityThreshold,
      results: Array.from(bestScoreByProfile.values()).sort((a, b) => b.score - a.score),
    };
  }
}
