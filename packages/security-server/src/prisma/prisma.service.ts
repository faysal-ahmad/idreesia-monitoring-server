import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';

// Routed through the pg driver adapter rather than Prisma's native Rust query engine:
// that engine links its own copy of OpenSSL, which conflicts with the OpenSSL linked in by
// @u4/opencv4nodejs's imgcodecs dependency chain (GDAL -> GnuTLS-curl) when both are loaded
// in the same process, breaking TLS/connection setup. The driver adapter delegates to the
// same pg client used elsewhere in this codebase, sidestepping that conflict entirely.
//
// search_path is set explicitly on the pool: the adapter's own `schema` option only tells
// Prisma's query compiler how to qualify its own generated (model-based) queries — it doesn't
// touch the actual Postgres session, so it has no effect on hand-written $queryRaw/$executeRaw
// SQL. The old native engine used to configure this automatically from the connection string's
// `schema=` param; that type/table resolution for raw SQL (e.g. the bare `::vector` cast in
// MonitoringProfileService.addImage) now has to come from the session's search_path instead.
//
// connectionTimeoutMillis: pg waits forever for a connection by default, so an unreachable
// database would hang the ingestion loops' alert writes and the background jobs instead of
// failing them (they all retry later).
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  options: '-c search_path=security_server,public',
  connectionTimeoutMillis: 10_000,
});

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor() {
    super({ adapter: new PrismaPg(pool, { schema: 'security_server' }) });
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
