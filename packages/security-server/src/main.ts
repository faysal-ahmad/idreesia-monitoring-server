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

// The server runs unattended, so a stray error in some background callback must not take down
// every channel's ingestion with it: log it and keep running. Node's default is to exit on both.
// Native crashes (OpenCV, ONNX) can't be caught here; Docker's restart policy covers those.
process.on('unhandledRejection', (reason) => {
  Logger.error(`Unhandled promise rejection: ${reason instanceof Error ? reason.stack : reason}`, 'Process');
});
process.on('uncaughtException', (error) => {
  Logger.error(`Uncaught exception: ${error.stack ?? error}`, 'Process');
});

// A failed startup, by contrast, exits so Docker restarts it, rather than lingering half-started
// (which the handlers above would otherwise allow).
bootstrap().catch((error) => {
  Logger.error(`Startup failed: ${error instanceof Error ? error.stack : error}`, 'Process');
  process.exit(1);
});
