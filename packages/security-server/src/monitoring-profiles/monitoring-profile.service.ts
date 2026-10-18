import { Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import * as cv from '@u4/opencv4nodejs';
import { AlertEventsService } from '../alerts/alert-events.service';
import { AlertImageStorageService } from '../alerts/alert-image-storage.service';
import { vectorToSql } from '../common/pgvector.util';
import { PrismaService } from '../prisma/prisma.service';
import { FaceDetectionService } from '../recognition/face-detection.service';
import { EMBEDDING_MODEL_VERSION, FaceRecognitionService } from '../recognition/face-recognition.service';
import { CreateMonitoringProfileDto, UpdateMonitoringProfileDto } from './monitoring-profile.schema';

// Detection is run permissively so marginal faces are still surfaced as a warning rather
// than silently missed; anything scoring below this isn't returned as a candidate face at all.
const DETECTION_SCORE_THRESHOLD = 0.6;
// A face scoring below this (but above DETECTION_SCORE_THRESHOLD) is still marginal quality.
const CONFIDENT_SCORE_THRESHOLD = 0.9;
// Below this, the crop is unusably blurry once resized to SFace's fixed 112x112 input.
const HARD_REJECT_MIN_PX = 40;
// Below this (but above the hard-reject floor), quality is marginal — warn, don't block.
const WARN_MIN_PX = 80;

export type ImageUploadResult =
  | { status: 'rejected'; reason: string }
  | { status: 'warning'; reason: string; faceBox: { width: number; height: number }; confidence: number }
  | { status: 'created'; image: { id: string; createdAt: Date } };

@Injectable()
export class MonitoringProfileService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly faceDetection: FaceDetectionService,
    private readonly faceRecognition: FaceRecognitionService,
    private readonly alertEvents: AlertEventsService,
    private readonly alertImages: AlertImageStorageService,
  ) {}

  async list() {
    const profiles = await this.prisma.monitoringProfile.findMany({
      include: { _count: { select: { images: true, alerts: true } } },
      orderBy: { createdAt: 'asc' },
    });
    return profiles.map((profile) => {
      const { _count, ...rest } = profile;
      return { ...rest, imageCount: _count.images, alertCount: _count.alerts };
    });
  }

  async findOne(id: string) {
    const profile = await this.prisma.monitoringProfile.findUnique({
      where: { id },
      include: { images: { select: { id: true, createdAt: true } } },
    });
    if (!profile) throw new NotFoundException('Monitoring profile not found.');

    const imagesWithPreview = await Promise.all(
      profile.images.map(async (image) => {
        const [row] = await this.prisma.$queryRaw<{ image: Uint8Array }[]>`
          SELECT image FROM security_server."MonitoringProfileImage" WHERE id = ${image.id}
        `;
        return {
          id: image.id,
          createdAt: image.createdAt,
          // $queryRaw deserializes bytea columns as a plain Uint8Array (not a Buffer), whose
          // toString() ignores the 'base64' arg and dumps comma-joined byte values instead.
          previewImage: `data:image/jpeg;base64,${Buffer.from(row.image).toString('base64')}`,
        };
      }),
    );

    return { ...profile, images: imagesWithPreview };
  }

  async create(dto: CreateMonitoringProfileDto) {
    return this.prisma.monitoringProfile.create({
      data: { name: dto.name, isTest: dto.isTest ?? false },
    });
  }

  async update(id: string, dto: UpdateMonitoringProfileDto) {
    await this.ensureExists(id);
    return this.prisma.monitoringProfile.update({
      where: { id },
      data: { name: dto.name, isTest: dto.isTest },
    });
  }

  async remove(id: string) {
    await this.ensureExists(id);
    // Cascades to MonitoringProfileImage and Alert rows per the schema's onDelete: Cascade — the
    // alerts' image files aren't in the DB, so they're collected first and removed afterwards.
    const alerts = await this.prisma.alert.findMany({ where: { monitoringProfileId: id }, select: { imageFile: true } });
    await this.prisma.monitoringProfile.delete({ where: { id } });
    await this.alertImages.remove(alerts.map((alert) => alert.imageFile));
    this.alertEvents.emit({ type: 'resync' });
  }

  async addImage(profileId: string, fileBuffer: Buffer, acknowledgeWarning: boolean): Promise<ImageUploadResult> {
    await this.ensureExists(profileId);

    const decoded = cv.imdecode(fileBuffer);
    const faces = this.faceDetection.detect(decoded, DETECTION_SCORE_THRESHOLD);

    if (faces.length === 0) {
      return { status: 'rejected', reason: 'No face was detected in this photo.' };
    }
    if (faces.length > 1) {
      return { status: 'rejected', reason: 'More than one face was detected — upload a photo of only this person.' };
    }

    const [face] = faces;
    const minDimension = Math.min(face.box.width, face.box.height);

    if (minDimension < HARD_REJECT_MIN_PX) {
      return { status: 'rejected', reason: 'The detected face is too small in this photo to produce a usable match.' };
    }

    const isMarginal = minDimension < WARN_MIN_PX || face.confidence < CONFIDENT_SCORE_THRESHOLD;
    if (isMarginal && !acknowledgeWarning) {
      return {
        status: 'warning',
        reason: 'This photo may produce a lower-quality match. Proceed anyway, or try a clearer photo.',
        faceBox: { width: face.box.width, height: face.box.height },
        confidence: face.confidence,
      };
    }

    const aligned = this.faceRecognition.align(decoded, face.landmarks);
    const embedding = this.faceRecognition.embed(aligned);
    const jpeg = cv.imencode('.jpg', decoded);

    const id = randomUUID();
    const embeddingSql = vectorToSql(embedding);
    await this.prisma.$executeRaw`
      INSERT INTO security_server."MonitoringProfileImage" (id, "profileId", image, embedding, "embeddingModelVersion", "createdAt")
      VALUES (${id}, ${profileId}, ${jpeg}, ${embeddingSql}::vector, ${EMBEDDING_MODEL_VERSION}, now())
    `;

    const [created] = await this.prisma.$queryRaw<{ id: string; createdAt: Date }[]>`
      SELECT id, "createdAt" FROM security_server."MonitoringProfileImage" WHERE id = ${id}
    `;
    return { status: 'created', image: created };
  }

  async removeImage(profileId: string, imageId: string) {
    await this.ensureExists(profileId);
    const deleted = await this.prisma.monitoringProfileImage.deleteMany({
      where: { id: imageId, profileId },
    });
    if (deleted.count === 0) {
      throw new NotFoundException('Image not found for this profile.');
    }
  }

  private async ensureExists(id: string) {
    const profile = await this.prisma.monitoringProfile.findUnique({ where: { id } });
    if (!profile) throw new NotFoundException('Monitoring profile not found.');
    return profile;
  }
}
