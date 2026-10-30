import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, VideoFeedSource } from '@prisma/client';
import * as cv from '@u4/opencv4nodejs';
import { parsePgVector } from '../common/pgvector.util';
import { PrismaService } from '../prisma/prisma.service';
import { FaceDetectionService } from '../recognition/face-detection.service';
import {
  detectionScaleFor,
  faceSizePx,
  resolveMinFaceQuality,
  resolveMinFaceSize,
  unscaleFace,
} from '../recognition/face-gate';
import { FaceQualityService } from '../recognition/face-quality.service';
import { FaceRecognitionService } from '../recognition/face-recognition.service';
import { DetectedFace } from '../recognition/recognition.types';
import { resolveSimilarityThreshold } from '../recognition/similarity-threshold';
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

interface ProfileImageRow {
  profileId: string;
  profileName: string;
  isTest: boolean;
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
    private readonly faceQuality: FaceQualityService,
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
        minFaceSizePx:
          dto.minFaceSizePx === undefined
            ? existing.minFaceSizePx
            : dto.minFaceSizePx,
        minFaceQuality:
          dto.minFaceQuality === undefined
            ? existing.minFaceQuality
            : dto.minFaceQuality,
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

  // Detected the way the live pipeline does (scaled for the channel, no close-up fallback), so
  // calibration sees the same faces, in the frame's own coordinates.
  private detectAsLive(frame: cv.Mat, source: VideoFeedSource): DetectedFace[] {
    const scale = detectionScaleFor(resolveMinFaceSize(source.minFaceSizePx));
    const detectionFrame = scale < 1 ? frame.rescale(scale) : frame;
    try {
      return this.faceDetection
        .detect(detectionFrame, undefined, undefined, false)
        .map((face) => unscaleFace(face, scale));
    } finally {
      if (detectionFrame !== frame) detectionFrame.release();
    }
  }

  // Every enrolled profile, test or not, whatever the includeTestProfilesInAlerts setting is.
  private async loadAllProfileEmbeddings() {
    const rows = await this.prisma.$queryRaw<ProfileImageRow[]>`
      SELECT mpi."profileId" as "profileId", mp.name as "profileName", mp."isTest" as "isTest",
        mpi.embedding::text as embedding
      FROM security_server."MonitoringProfileImage" mpi
      JOIN security_server."MonitoringProfile" mp ON mp.id = mpi."profileId"
      WHERE mp."deletedAt" IS NULL AND mpi.embedding IS NOT NULL
    `;
    return rows.map((row) => ({
      profileId: row.profileId,
      profileName: row.profileName,
      isTest: row.isTest,
      embedding: parsePgVector(row.embedding),
    }));
  }

  // Rates every face in a frame captured from the live view, so an admin can see the size and
  // quality the pipeline measures for each one, and which profile (if any) it matches at the
  // channel's threshold. Every face is matched, even one the live pipeline would skip for size or
  // quality, and against test profiles too; this never produces an Alert row.
  // Boxes are YuNet's own (unpadded), in image pixels.
  async analyzeFrame(id: string, image: Buffer) {
    const source = await this.findRaw(id);
    const threshold = resolveSimilarityThreshold(source.similarityThreshold);
    const profiles = await this.loadAllProfileEmbeddings();
    let frame: cv.Mat;
    try {
      frame = cv.imdecode(image);
    } catch {
      throw new BadRequestException('The captured frame could not be read.');
    }
    if (frame.empty) {
      throw new BadRequestException('The captured frame could not be read.');
    }

    try {
      const faces = this.detectAsLive(frame, source).map((face) => {
        const aligned = this.faceRecognition.align(frame, face.landmarks);
        try {
          const quality = this.faceQuality.assess(face, aligned);
          const embedding = this.faceRecognition.embed(aligned);
          let match: {
            profileId: string;
            profileName: string;
            isTest: boolean;
            score: number;
          } | null = null;
          for (const profile of profiles) {
            const score = this.faceRecognition.cosineSimilarity(
              embedding,
              profile.embedding,
            );
            if (score >= threshold && (!match || score > match.score)) {
              match = {
                profileId: profile.profileId,
                profileName: profile.profileName,
                isTest: profile.isTest,
                score,
              };
            }
          }
          return {
            box: face.box,
            confidence: face.confidence,
            sizePx: faceSizePx(face),
            quality: quality.score,
            qualityReasons: quality.reasons,
            match,
          };
        } finally {
          aligned.release();
        }
      });
      return {
        width: frame.cols,
        height: frame.rows,
        minFaceSizePx: resolveMinFaceSize(source.minFaceSizePx),
        minFaceQuality: resolveMinFaceQuality(source.minFaceQuality),
        similarityThreshold: threshold,
        faces,
      };
    } finally {
      frame.release();
    }
  }
}
