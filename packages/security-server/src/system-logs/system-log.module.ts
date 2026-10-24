import { Module } from '@nestjs/common';
import { SystemLogController } from './system-log.controller';
import { SystemLogService } from './system-log.service';

@Module({
  controllers: [SystemLogController],
  providers: [SystemLogService],
  // For the code that records entries: channel CRUD and ingestion's auto-disable.
  exports: [SystemLogService],
})
export class SystemLogModule {}
