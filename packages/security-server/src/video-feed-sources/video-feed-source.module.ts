import { Module } from '@nestjs/common';
import { MediaServerModule } from '../media-server/media-server.module';
import { RecognitionModule } from '../recognition/recognition.module';
import { SystemLogModule } from '../system-logs/system-log.module';
import { VideoFeedSourceController } from './video-feed-source.controller';
import { VideoFeedSourceService } from './video-feed-source.service';

@Module({
  imports: [RecognitionModule, MediaServerModule, SystemLogModule],
  controllers: [VideoFeedSourceController],
  providers: [VideoFeedSourceService],
})
export class VideoFeedSourceModule {}
