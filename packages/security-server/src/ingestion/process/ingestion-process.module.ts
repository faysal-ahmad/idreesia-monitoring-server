import { Module } from '@nestjs/common';
import { RecognitionModule } from '../../recognition/recognition.module';
import { ChannelStatsRecorder } from '../channel-stats-recorder';
import { ChannelLoopService } from './channel-loop.service';
import { FramePipelineService } from './frame-pipeline.service';
import { ParentChannel } from './parent-channel';
import { ProcessMatchCache } from './process-match-cache';

// Everything an ingestion process runs: no database, no HTTP. The main process owns those and
// talks to this one over IPC (see ingestion-protocol.ts).
@Module({
  imports: [RecognitionModule],
  providers: [
    ChannelLoopService,
    FramePipelineService,
    ProcessMatchCache,
    ChannelStatsRecorder,
    ParentChannel,
  ],
})
export class IngestionProcessModule {}
