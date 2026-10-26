import { Controller, HttpCode, Post } from '@nestjs/common';
import { FaceMatchCacheService } from '../ingestion/face-match-cache.service';
import { VideoIngestionService } from '../ingestion/video-ingestion.service';

// The server never polls the database on its own schedule. Changes from the ERP sync reload by
// themselves; the UI calls this endpoint right after any channel, profile, image or configuration
// change it makes, to pick up the fresh state.
@Controller('system')
export class SystemController {
  constructor(
    private readonly videoIngestion: VideoIngestionService,
    private readonly matchCache: FaceMatchCacheService,
  ) {}

  @Post('reload')
  @HttpCode(204)
  async reload() {
    await Promise.all([this.videoIngestion.reconcile(), this.matchCache.refresh()]);
  }
}
