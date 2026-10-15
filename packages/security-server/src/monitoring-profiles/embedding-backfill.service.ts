import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as cv from '@u4/opencv4nodejs';
import { vectorToSql } from '../common/pgvector.util';
import { FaceMatchCacheService } from '../ingestion/face-match-cache.service';
import { PrismaService } from '../prisma/prisma.service';
import { FaceDetectionService } from '../recognition/face-detection.service';
import { EMBEDDING_MODEL_VERSION, FaceRecognitionService } from '../recognition/face-recognition.service';

// Same permissive threshold enrollment uses (see MonitoringProfileService) - every stored image
// already passed that gate once, so this only needs to find the face again, not re-judge quality.
const DETECTION_SCORE_THRESHOLD = 0.6;

// Recomputes enrollment embeddings stored under any pipeline version other than the current
// EMBEDDING_MODEL_VERSION, from the enrollment photo kept alongside each one. Runs once at
// startup - the watch list is small (well under a few hundred images), so this takes seconds
// and needs no manual trigger. Without it, live frames embedded by the current pipeline would be
// compared against stale embeddings that aren't comparable with them.
@Injectable()
export class EmbeddingBackfillService implements OnModuleInit {
  private readonly logger = new Logger(EmbeddingBackfillService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly faceDetection: FaceDetectionService,
    private readonly faceRecognition: FaceRecognitionService,
    private readonly matchCache: FaceMatchCacheService,
  ) {}

  async onModuleInit() {
    await this.backfill();
  }

  async backfill() {
    const rows = await this.prisma.$queryRaw<{ id: string; image: Uint8Array }[]>`
      SELECT id, image FROM security_server."MonitoringProfileImage"
      WHERE "embeddingModelVersion" IS DISTINCT FROM ${EMBEDDING_MODEL_VERSION}
    `;
    if (rows.length === 0) return;

    this.logger.log(`Recomputing ${rows.length} embedding(s) for pipeline version ${EMBEDDING_MODEL_VERSION}`);

    let recomputed = 0;
    for (const row of rows) {
      const decoded = cv.imdecode(Buffer.from(row.image));
      const faces = this.faceDetection.detect(decoded, DETECTION_SCORE_THRESHOLD);
      if (faces.length === 0) {
        // Left on its old version, so it's retried on the next startup - the stale embedding
        // stays in the match set meanwhile, which is no worse than before this backfill existed.
        this.logger.warn(`No face re-detected in monitoring profile image ${row.id}; embedding left stale`);
        continue;
      }

      const face = faces.reduce((best, f) => (f.confidence > best.confidence ? f : best));
      const embedding = this.faceRecognition.embed(this.faceRecognition.align(decoded, face.landmarks));
      const embeddingSql = vectorToSql(embedding);
      await this.prisma.$executeRaw`
        UPDATE security_server."MonitoringProfileImage"
        SET embedding = ${embeddingSql}::vector, "embeddingModelVersion" = ${EMBEDDING_MODEL_VERSION}
        WHERE id = ${row.id}
      `;
      recomputed++;
    }

    this.logger.log(`Recomputed ${recomputed} of ${rows.length} embedding(s)`);
    // The cache may already have loaded the stale embeddings during its own onModuleInit.
    await this.matchCache.refresh();
  }
}
