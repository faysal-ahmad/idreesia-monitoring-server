import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  Res,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { AdminSessionService, readCookie, SESSION_COOKIE, SESSION_TTL_MS } from './admin-session.service';
import { LoginSchema } from './auth.schema';
import { Public } from './public.decorator';

// HttpOnly so page scripts can't read it; SameSite=Strict so other sites can't ride on it. Not
// Secure, since the UI is also served over plain HTTP on the local network.
const COOKIE_OPTIONS = { httpOnly: true, sameSite: 'strict', path: '/' } as const;

@Controller('auth')
export class AuthController {
  constructor(private readonly sessions: AdminSessionService) {}

  @Public()
  @Get('session')
  session(@Req() request: Request) {
    return { authenticated: this.sessions.verifyToken(readCookie(request.headers.cookie, SESSION_COOKIE)) };
  }

  @Public()
  @Post('login')
  @HttpCode(204)
  login(
    @Body(new ZodValidationPipe(LoginSchema)) dto: ReturnType<typeof LoginSchema.parse>,
    @Res({ passthrough: true }) response: Response,
  ) {
    if (!this.sessions.isConfigured) {
      throw new ServiceUnavailableException('Admin password is not configured on the server.');
    }
    if (!this.sessions.checkPassword(dto.password)) throw new UnauthorizedException('Incorrect password.');
    response.cookie(SESSION_COOKIE, this.sessions.createToken(), { ...COOKIE_OPTIONS, maxAge: SESSION_TTL_MS });
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  logout(@Res({ passthrough: true }) response: Response) {
    response.clearCookie(SESSION_COOKIE, COOKIE_OPTIONS);
  }

  // Not public: nginx's auth_request calls this to gate the live video WebSocket, which bypasses
  // the API (204 = allowed, 401 = denied).
  @Get('check')
  @HttpCode(204)
  check() {
    return;
  }
}
