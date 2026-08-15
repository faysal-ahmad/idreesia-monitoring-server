import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app/app.module';

// HTTP server (management API for security-server-ui) plus the existing scheduled-job
// support (ScheduleModule/AppService's heartbeat, and later the frame-processing loop).
// enableShutdownHooks lets Nest clean both up on SIGTERM.
async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.enableCors();
  app.setGlobalPrefix('api');
  app.enableShutdownHooks();

  const port = process.env.PORT ? Number(process.env.PORT) : 3000;
  await app.listen(port, '0.0.0.0');
  Logger.log(`🚀 security-server is running on port ${port}`);
}

bootstrap();
