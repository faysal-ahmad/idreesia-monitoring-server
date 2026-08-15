import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, VideoFeedSource } from '@prisma/client';
import * as cv from '@u4/opencv4nodejs';
import { parsePgVector } from '../common/pgvector.util';
import { PrismaService } from '../prisma/prisma.service';
import { FaceDetectionService } from '../recognition/face-detection.service';
import { FaceRecognitionService } from '../recognition/face-recognition.service';
import { VideoCaptureService } from '../recognition/video-capture.service';
import { parseVideoFeedSourceConfig, redactConfig } from './video-feed-source-config.schema';
import { CreateVideoFeedSourceDto, UpdateVideoFeedSourceDto } from './video-feed-source.schema';

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

  async create(dto: CreateVideoFeedSourceDto) {
    const created = await this.prisma.videoFeedSource.create({
      data: {
        name: dto.name,
        type: dto.type,
        config: dto.config,
        enabled: dto.enabled ?? true,
      },
    });
    return this.serialize(created);
  }

  async update(id: string, dto: UpdateVideoFeedSourceDto) {
    const existing = await this.findRaw(id);
    const config = dto.config
      ? parseVideoFeedSourceConfig(existing.type, dto.config)
      : (existing.config as Record<string, unknown>);

    const updated = await this.prisma.videoFeedSource.update({
      where: { id },
      data: {
        name: dto.name ?? existing.name,
        config: config as Prisma.InputJsonValue,
        enabled: dto.enabled ?? existing.enabled,
        similarityThreshold:
          dto.similarityThreshold === undefined ? existing.similarityThreshold : dto.similarityThreshold,
      },
    });
    return this.serialize(updated);
  }

  async remove(id: string) {
    const existing = await this.findRaw(id);
    if (!existing.removable) {
      throw new ForbiddenException('This channel cannot be removed.');
    }
    // A P2003 here (Alert history referencing this channel) is translated to a 409
    // by the global PrismaExceptionFilter rather than surfacing a raw constraint error.
    await this.prisma.videoFeedSource.delete({ where: { id } });
  }

  async verify(id: string) {
    const source = await this.findRaw(id);
    const config = parseVideoFeedSourceConfig(source.type, source.config);
    const result = this.videoCapture.captureFrame(source.type, config);
    if (!result.reachable || !result.frame) {
      return { reachable: false, error: result.error };
    }
    const jpeg = cv.imencode('.jpg', result.frame);
    return { reachable: true, previewImage: `data:image/jpeg;base64,${jpeg.toString('base64')}` };
  }

  async testMatch(id: string) {
    const source = await this.findRaw(id);
    const config = parseVideoFeedSourceConfig(source.type, source.config);
    const captureResult = this.videoCapture.captureFrame(source.type, config);
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
