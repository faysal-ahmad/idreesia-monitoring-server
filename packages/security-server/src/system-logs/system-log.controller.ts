import { Controller, Get, Query } from '@nestjs/common';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { ListSystemLogsQuerySchema } from './system-log.schema';
import { SystemLogService } from './system-log.service';

@Controller('system-logs')
export class SystemLogController {
  constructor(private readonly service: SystemLogService) {}

  @Get()
  list(
    @Query(new ZodValidationPipe(ListSystemLogsQuerySchema))
    query: ReturnType<typeof ListSystemLogsQuerySchema.parse>,
  ) {
    return this.service.list(query);
  }
}
