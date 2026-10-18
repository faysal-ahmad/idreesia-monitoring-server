import { Controller, HttpCode, Post } from '@nestjs/common';
import { FaceMatchCacheService } from '../ingestion/face-match-cache.service';
import { VideoIngestionService } from '../ingestion/video-ingestion.service';

// The server never polls the database on its own schedule — every mutation (channels,
// monitoring profiles, profile images, configuration) happens through the UI, which calls this endpoint
// right after a change to tell the server to pick up the fresh state.
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
