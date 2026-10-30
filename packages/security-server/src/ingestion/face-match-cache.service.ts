import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { parsePgVector } from '../common/pgvector.util';
import { ConfigurationService } from '../configuration/configuration.service';
import { PrismaService } from '../prisma/prisma.service';
import { IngestionProcessPoolService } from './ingestion-process-pool.service';

// The match set for the live alert pipeline — loaded once at startup and refreshed whenever a
// monitoring profile, its images, or the configuration change (via /system/reload), then sent to
// every ingestion process, which matches against its own copy (process/process-match-cache.ts).
// Test profiles are left out unless the includeTestProfilesInAlerts setting is on, since they
// are normally calibration-only. Matching stays in-memory — see docs/face-recognition.md for when
// this would need to move to pgvector instead (tens of thousands of embeddings, not the
// <50-profile scale this is scoped to).
@Injectable()
export class FaceMatchCacheService implements OnModuleInit {
  private readonly logger = new Logger(FaceMatchCacheService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configuration: ConfigurationService,
    private readonly pool: IngestionProcessPoolService,
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
    const entries = rows.map((row) => ({
      profileId: row.profileId,
      profileName: row.profileName,
      embedding: parsePgVector(row.embedding),
    }));
    this.pool.setMatchCache(entries);
    this.logger.log(
      `Match cache refreshed: ${entries.length} embeddings across the watch list` +
        (includeTestProfilesInAlerts ? ' (including test profiles)' : ''),
    );
  }
}
