import { Module } from '@nestjs/common';
import { RecognitionModule } from '../recognition/recognition.module';
import { MediaServerService } from './media-server.service';

@Module({
  imports: [RecognitionModule],
  providers: [MediaServerService],
  exports: [MediaServerService],
})
export class MediaServerModule {}
