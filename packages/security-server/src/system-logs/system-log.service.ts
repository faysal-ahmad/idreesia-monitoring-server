import { Injectable } from '@nestjs/common';
import { Prisma, SystemLogEvent, SystemLogSource } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ListSystemLogsQuery } from './system-log.schema';

export interface SystemLogEntry {
  event: SystemLogEvent;
  source: SystemLogSource;
  channel?: { id: string; name: string };
  message: string;
}

@Injectable()
export class SystemLogService {
  constructor(private readonly prisma: PrismaService) {}

  // Pass `tx` to write the entry in the same transaction as the change it records, so a change
  // is never saved without its log entry (or the other way round).
  async record(
    entry: SystemLogEntry,
    tx: Prisma.TransactionClient = this.prisma,
  ) {
    await tx.systemLog.create({
      data: {
        event: entry.event,
        source: entry.source,
        channelId: entry.channel?.id,
        channelName: entry.channel?.name,
        message: entry.message,
      },
    });
  }

  // One page of the (newest-first) log.
  async list(query: ListSystemLogsQuery) {
    const [total, logs] = await this.prisma.$transaction([
      this.prisma.systemLog.count(),
      this.prisma.systemLog.findMany({
        orderBy: { timestamp: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return { data: logs, total };
  }
}
