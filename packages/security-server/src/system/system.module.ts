import { Module } from '@nestjs/common';
import { IngestionModule } from '../ingestion/ingestion.module';
import { SystemController } from './system.controller';

@Module({
  imports: [IngestionModule],
  controllers: [SystemController],
})
export class SystemModule {}
