import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import {
  AdminSessionService,
  readCookie,
  SESSION_COOKIE,
} from './admin-session.service';
import { IS_PUBLIC_KEY } from './public.decorator';

// Registered globally (APP_GUARD), so a new controller is admin-only unless marked @Public().
@Injectable()
export class AdminAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: AdminSessionService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<Request>();
    if (
      this.sessions.verifyToken(
        readCookie(request.headers.cookie, SESSION_COOKIE),
      )
    )
      return true;
    throw new UnauthorizedException('Admin login required.');
  }
}
