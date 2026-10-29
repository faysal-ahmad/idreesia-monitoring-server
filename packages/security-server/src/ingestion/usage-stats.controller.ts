import { Controller, Get, Query } from '@nestjs/common';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { UsageStatsQuerySchema } from './usage-stats.schema';
import { UsageStatsQueryService } from './usage-stats-query.service';

// Admin only: per-camera load figures for the Usage page.
@Controller('usage-stats')
export class UsageStatsController {
  constructor(private readonly service: UsageStatsQueryService) {}

  @Get()
  summary(
    @Query(new ZodValidationPipe(UsageStatsQuerySchema))
    query: ReturnType<typeof UsageStatsQuerySchema.parse>,
  ) {
    return this.service.summary(query.minutes);
  }
}
