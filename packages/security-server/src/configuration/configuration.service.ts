import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateConfigurationDto } from './configuration.schema';

// Fixed id — Configuration is a single-row (singleton) table, not a generic key-value store.
const CONFIGURATION_ID = 'default';

@Injectable()
export class ConfigurationService {
  constructor(private readonly prisma: PrismaService) {}

  // Defensive upsert rather than a plain read — guarantees the row exists even if seeding
  // was skipped (e.g. an existing DB that predates this table).
  async get() {
    return this.prisma.configuration.upsert({
      where: { id: CONFIGURATION_ID },
      update: {},
      create: { id: CONFIGURATION_ID },
    });
  }

  async update(dto: UpdateConfigurationDto) {
    return this.prisma.configuration.upsert({
      where: { id: CONFIGURATION_ID },
      update: dto,
      create: { id: CONFIGURATION_ID, ...dto },
    });
  }
}
