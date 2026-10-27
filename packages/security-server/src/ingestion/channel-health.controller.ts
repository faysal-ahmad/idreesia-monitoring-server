import { Controller, Get } from '@nestjs/common';
import { Public } from '../auth/public.decorator';
import { VideoIngestionService } from './video-ingestion.service';

// Public for the Alerts page, so viewers can tell a quiet camera from a dead one. Only names and
// status — nothing about how to reach the cameras.
@Public()
@Controller('channel-health')
export class ChannelHealthController {
  constructor(private readonly videoIngestion: VideoIngestionService) {}

  @Get()
  list() {
    return this.videoIngestion.health();
  }
}
