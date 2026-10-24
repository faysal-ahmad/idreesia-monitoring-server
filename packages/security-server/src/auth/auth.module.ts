import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AdminAuthGuard } from './admin-auth.guard';
import { AdminSessionService } from './admin-session.service';
import { AuthController } from './auth.controller';

@Module({
  controllers: [AuthController],
  providers: [AdminSessionService, { provide: APP_GUARD, useClass: AdminAuthGuard }],
})
export class AuthModule {}
