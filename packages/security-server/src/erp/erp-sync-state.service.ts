import { Injectable } from '@nestjs/common';
import { ErpSyncState } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const STATE_ID = 1;

export type ErpSyncStateUpdate = Partial<
  Pick<ErpSyncState, 'pullCursor' | 'lastSyncStartedAt' | 'lastSyncedAt' | 'lastSyncError'>
>;

// The single ErpSyncState row, created on first use.
@Injectable()
export class ErpSyncStateService {
  constructor(private readonly prisma: PrismaService) {}

  async get(): Promise<ErpSyncState> {
    await this.ensureRow();
    return this.prisma.erpSyncState.findUniqueOrThrow({ where: { id: STATE_ID } });
  }

  async update(data: ErpSyncStateUpdate): Promise<ErpSyncState> {
    await this.ensureRow();
    return this.prisma.erpSyncState.update({ where: { id: STATE_ID }, data });
  }

  // Not an upsert: two concurrent upserts of a missing row both try to insert it, and one fails.
  private async ensureRow() {
    await this.prisma.erpSyncState.createMany({ data: [{ id: STATE_ID }], skipDuplicates: true });
  }
}
