import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { parsePgVector } from '../common/pgvector.util';
import { ConfigurationService } from '../configuration/configuration.service';
import { PrismaService } from '../prisma/prisma.service';
import { FaceRecognitionService } from '../recognition/face-recognition.service';

interface CachedEmbedding {
  profileId: string;
  profileName: string;
  embedding: number[];
}

export interface MatchResult {
  profileId: string;
  profileName: string;
  score: number;
}

// In-memory match set for the live alert pipeline — loaded once at startup and refreshed
// whenever a monitoring profile, its images, or the configuration change (via /system/reload).
// Test profiles are left out unless the includeTestProfilesInAlerts setting is on, since they
// are normally calibration-only. Brute-force cosine comparison against ~150 embeddings is on the
// order of microseconds, negligible next to per-frame detection/embedding cost — see the plan's
// "Matching stays in-memory" rationale for when this would need to move to pgvector instead
// (tens of thousands of embeddings, not the <50-profile scale this is scoped to).
@Injectable()
export class FaceMatchCacheService implements OnModuleInit {
  private readonly logger = new Logger(FaceMatchCacheService.name);
  private cache: CachedEmbedding[] = [];

  constructor(
    private readonly prisma: PrismaService,
    private readonly faceRecognition: FaceRecognitionService,
    private readonly configuration: ConfigurationService,
  ) {}

  async onModuleInit() {
    await this.refresh();
  }

  async refresh() {
    const { includeTestProfilesInAlerts } = await this.configuration.getAll();
    const rows = await this.prisma.$queryRaw<
      { profileId: string; profileName: string; embedding: string }[]
    >`
      SELECT mpi."profileId" as "profileId", mp.name as "profileName", mpi.embedding::text as embedding
      FROM security_server."MonitoringProfileImage" mpi
      JOIN security_server."MonitoringProfile" mp ON mp.id = mpi."profileId"
      WHERE mp."deletedAt" IS NULL
        AND mpi.embedding IS NOT NULL
        AND (mp."isTest" = false OR ${includeTestProfilesInAlerts})
    `;
    this.cache = rows.map((row) => ({
      profileId: row.profileId,
      profileName: row.profileName,
      embedding: parsePgVector(row.embedding),
    }));
    this.logger.log(
      `Match cache refreshed: ${this.cache.length} embeddings across the watch list` +
        (includeTestProfilesInAlerts ? ' (including test profiles)' : ''),
    );
  }

  findBestMatch(embedding: number[], threshold: number): MatchResult | null {
    let best: MatchResult | null = null;
    for (const entry of this.cache) {
      const score = this.faceRecognition.cosineSimilarity(
        embedding,
        entry.embedding,
      );
      if (score >= threshold && (!best || score > best.score)) {
        best = {
          profileId: entry.profileId,
          profileName: entry.profileName,
          score,
        };
      }
    }
    return best;
  }
}
