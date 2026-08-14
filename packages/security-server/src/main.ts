import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app/app.module';

// Standalone Nest context — this service has no HTTP/RPC listener, it's a
// long-running background worker. Wire scheduled jobs/queue consumers into
// AppModule and enableShutdownHooks lets Nest clean them up on SIGTERM.
async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  app.enableShutdownHooks();
  Logger.log('🚀 security-server is running');
}

bootstrap();
