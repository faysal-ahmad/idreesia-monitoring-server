import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { AlertModule } from '../alerts/alert.module';
import { AuthModule } from '../auth/auth.module';
import { PrismaExceptionFilter } from '../common/prisma-exception.filter';
import { ConfigurationModule } from '../configuration/configuration.module';
import { IngestionModule } from '../ingestion/ingestion.module';
import { MonitoringProfileModule } from '../monitoring-profiles/monitoring-profile.module';
import { PrismaModule } from '../prisma/prisma.module';
import { SystemModule } from '../system/system.module';
import { SystemLogModule } from '../system-logs/system-log.module';
import { VideoFeedSourceModule } from '../video-feed-sources/video-feed-source.module';
import { AppService } from './app.service';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    PrismaModule,
    AuthModule,
    VideoFeedSourceModule,
    MonitoringProfileModule,
    AlertModule,
    IngestionModule,
    SystemModule,
    ConfigurationModule,
    SystemLogModule,
  ],
  providers: [AppService, { provide: APP_FILTER, useClass: PrismaExceptionFilter }],
})
export class AppModule {}
