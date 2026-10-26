import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Observable, Subject } from 'rxjs';
import { PrismaService } from '../prisma/prisma.service';
import { CONFIG_DEFINITIONS, ConfigKey, ConfigValues, UpdateConfigurationDto } from './configuration.schema';

@Injectable()
export class ConfigurationService {
  private readonly changes = new Subject<ConfigValues>();
  // Emits the full settings after every update, for services that schedule work by a setting.
  readonly changes$: Observable<ConfigValues> = this.changes.asObservable();

  constructor(private readonly prisma: PrismaService) {}

  // Missing rows (e.g. a setting added after this DB was seeded) fall back to their
  // registry default rather than requiring a migration or re-seed.
  async getAll(): Promise<ConfigValues> {
    const rows = await this.prisma.configuration.findMany();
    const byKey = new Map(rows.map((row) => [row.key, row.value]));

    return Object.fromEntries(
      Object.entries(CONFIG_DEFINITIONS).map(([key, definition]) => [
        key,
        byKey.has(key) ? definition.schema.parse(byKey.get(key)) : definition.default,
      ]),
    ) as ConfigValues;
  }

  async update(dto: UpdateConfigurationDto): Promise<ConfigValues> {
    await Promise.all(
      (Object.entries(dto) as [ConfigKey, ConfigValues[ConfigKey]][]).map(([key, value]) =>
        this.prisma.configuration.upsert({
          where: { key },
          update: { value: value as Prisma.InputJsonValue },
          create: { key, displayName: CONFIG_DEFINITIONS[key].displayName, value: value as Prisma.InputJsonValue },
        }),
      ),
    );
    const values = await this.getAll();
    this.changes.next(values);
    return values;
  }
}
