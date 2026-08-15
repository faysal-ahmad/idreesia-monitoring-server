import { Module } from '@nestjs/common';
import { RecognitionModule } from '../recognition/recognition.module';
import { VideoFeedSourceController } from './video-feed-source.controller';
import { VideoFeedSourceService } from './video-feed-source.service';

@Module({
  imports: [RecognitionModule],
  controllers: [VideoFeedSourceController],
  providers: [VideoFeedSourceService],
})
export class VideoFeedSourceModule {}
