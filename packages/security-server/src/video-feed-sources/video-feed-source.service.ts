import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, VideoFeedSource } from '@prisma/client';
import { parsePgVector } from '../common/pgvector.util';
import { MediaServerService } from '../media-server/media-server.service';
import { PrismaService } from '../prisma/prisma.service';
import { FaceDetectionService } from '../recognition/face-detection.service';
import { FaceRecognitionService } from '../recognition/face-recognition.service';
import { VideoCaptureService } from '../recognition/video-capture.service';
import {
  mergeStoredCredentials,
  parseRtspConfig,
  redactConfig,
  RtspConfigSchema,
} from './video-feed-source-config.schema';
import {
  CreateVideoFeedSourceDto,
  UpdateVideoFeedSourceDto,
  VerifyVideoFeedSourceDto,
} from './video-feed-source.schema';

const ACTIVE = { deletedAt: null };

interface TestMatchImageRow {
  profileId: string;
  profileName: string;
  embedding: string;
}

// Channels are edited here and in the ERP; ErpSyncService keeps the two in step. A delete keeps
// the row (deletedAt) until the ERP has been told, so every read here skips deleted ones.
@Injectable()
export class VideoFeedSourceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly videoCapture: VideoCaptureService,
    private readonly faceDetection: FaceDetectionService,
    private readonly faceRecognition: FaceRecognitionService,
    private readonly mediaServer: MediaServerService,
  ) {}

  private serialize(source: VideoFeedSource) {
    return {
      ...source,
      config: redactConfig(source.config as Record<string, unknown>),
    };
  }

  async list() {
    const sources = await this.prisma.videoFeedSource.findMany({
      where: ACTIVE,
      include: { _count: { select: { alerts: true } } },
      orderBy: { name: 'asc' },
    });
    return sources.map((source) => {
      const { _count, ...rest } = source;
      return {
        ...this.serialize(rest as VideoFeedSource),
        alertCount: _count.alerts,
      };
    });
  }

  async findOne(id: string) {
    return this.serialize(await this.findRaw(id));
  }

  private async findRaw(id: string): Promise<VideoFeedSource> {
    const source = await this.prisma.videoFeedSource.findFirst({
      where: { id, ...ACTIVE },
    });
    if (!source) throw new NotFoundException('Video feed source not found.');
    return source;
  }

  async create(dto: CreateVideoFeedSourceDto) {
    const created = await this.prisma.videoFeedSource.create({
      data: {
        name: dto.name,
        config: dto.config,
        enabled: dto.enabled ?? true,
      },
    });
    return this.serialize(created);
  }

  async update(id: string, dto: UpdateVideoFeedSourceDto) {
    const existing = await this.findRaw(id);
    const config = dto.config
      ? parseRtspConfig(
          mergeStoredCredentials(
            existing.config as Record<string, unknown>,
            dto.config,
          ),
        )
      : (existing.config as Record<string, unknown>);

    const updated = await this.prisma.videoFeedSource.update({
      where: { id },
      data: {
        name: dto.name ?? existing.name,
        config: config as Prisma.InputJsonValue,
        enabled: dto.enabled ?? existing.enabled,
        similarityThreshold:
          dto.similarityThreshold === undefined
            ? existing.similarityThreshold
            : dto.similarityThreshold,
        recognitionFps: dto.recognitionFps ?? existing.recognitionFps,
      },
    });
    return this.serialize(updated);
  }

  async remove(id: string) {
    const existing = await this.findRaw(id);
    // Checked up front: the Alert FK (onDelete: Restrict) would block it anyway, but through the pg
    // driver adapter that surfaces as an untyped error the PrismaExceptionFilter can't map to a 409.
    if ((await this.prisma.alert.count({ where: { channelId: id } })) > 0) {
      throw new ConflictException(
        'This channel has alert history and cannot be deleted.',
      );
    }
    if (existing.externalId) {
      // Kept until the next sync tells the ERP.
      await this.prisma.videoFeedSource.update({
        where: { id },
        data: { deletedAt: new Date() },
      });
    } else {
      // Never reached the ERP, so there's nothing to tell it.
      await this.prisma.videoFeedSource.delete({ where: { id } });
    }
  }

  async verify(dto: VerifyVideoFeedSourceDto) {
    const incoming = dto.channelId
      ? mergeStoredCredentials(
          (await this.findRaw(dto.channelId)).config as Record<string, unknown>,
          dto.config,
        )
      : dto.config;
    const parsed = RtspConfigSchema.safeParse(incoming);
    if (!parsed.success) {
      throw new BadRequestException(
        'The connection details are incomplete or invalid.',
      );
    }
    const result = this.videoCapture.captureFrame(
      this.videoCapture.buildRtspUrl(parsed.data),
    );
    return result.reachable
      ? { reachable: true }
      : { reachable: false, error: result.error };
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
      throw new BadRequestException(
        captureResult.error ?? 'Could not capture a frame from this channel.',
      );
    }

    const faces = this.faceDetection.detect(captureResult.frame);
    if (faces.length === 0) {
      throw new BadRequestException('No face detected in the captured frame.');
    }
    const face = faces.reduce((best, current) =>
      current.confidence > best.confidence ? current : best,
    );
    const aligned = this.faceRecognition.align(
      captureResult.frame,
      face.landmarks,
    );
    const embedding = this.faceRecognition.embed(aligned);

    // Test-match calibration only ever compares against isTest profiles — real watch-list
    // profiles are never in scope here, and this can never produce an Alert row.
    const testImages = await this.prisma.$queryRaw<TestMatchImageRow[]>`
      SELECT mpi."profileId" as "profileId", mp.name as "profileName", mpi.embedding::text as embedding
      FROM security_server."MonitoringProfileImage" mpi
      JOIN security_server."MonitoringProfile" mp ON mp.id = mpi."profileId"
      WHERE mp."isTest" = true AND mp."deletedAt" IS NULL AND mpi.embedding IS NOT NULL
    `;

    const bestScoreByProfile = new Map<
      string,
      { profileId: string; profileName: string; score: number }
    >();
    for (const row of testImages) {
      const storedEmbedding = parsePgVector(row.embedding);
      const score = this.faceRecognition.cosineSimilarity(
        embedding,
        storedEmbedding,
      );
      const existing = bestScoreByProfile.get(row.profileId);
      if (!existing || score > existing.score) {
        bestScoreByProfile.set(row.profileId, {
          profileId: row.profileId,
          profileName: row.profileName,
          score,
        });
      }
    }

    return {
      detectedFaceConfidence: face.confidence,
      currentSimilarityThreshold: source.similarityThreshold,
      results: Array.from(bestScoreByProfile.values()).sort(
        (a, b) => b.score - a.score,
      ),
    };
  }
}
