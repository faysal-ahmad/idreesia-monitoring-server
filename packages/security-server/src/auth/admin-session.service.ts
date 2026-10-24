import { Injectable, Logger } from '@nestjs/common';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export const SESSION_COOKIE = 'admin_session';
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// A single shared admin password, from ADMIN_PASSWORD. Sessions are stateless signed tokens
// (`<expiresAt>.<hmac>`) in an HttpOnly cookie, keyed off the password itself, so changing the
// password and restarting logs every admin out.
@Injectable()
export class AdminSessionService {
  private readonly logger = new Logger(AdminSessionService.name);
  private readonly password = process.env.ADMIN_PASSWORD || '';
  private readonly signingKey = createHash('sha256').update(`admin-session:${this.password}`).digest();

  constructor() {
    if (!this.password) {
      this.logger.warn('ADMIN_PASSWORD is not set — admin pages and APIs are inaccessible until it is.');
    }
  }

  get isConfigured(): boolean {
    return !!this.password;
  }

  checkPassword(candidate: string): boolean {
    // Comparing digests keeps the comparison constant-time regardless of length.
    return this.isConfigured && safeEqual(sha256(candidate), sha256(this.password));
  }

  createToken(): string {
    const expiresAt = String(Date.now() + SESSION_TTL_MS);
    return `${expiresAt}.${this.sign(expiresAt)}`;
  }

  verifyToken(token: string | undefined): boolean {
    if (!this.isConfigured || !token) return false;
    const [expiresAt, signature] = token.split('.');
    if (!expiresAt || !signature) return false;
    if (!safeEqual(Buffer.from(signature), Buffer.from(this.sign(expiresAt)))) return false;
    return Number(expiresAt) > Date.now();
  }

  private sign(value: string): string {
    return createHmac('sha256', this.signingKey).update(value).digest('base64url');
  }
}

function sha256(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}

function safeEqual(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}

// No cookie-parser dependency for a single cookie.
export function readCookie(header: string | undefined, name: string): string | undefined {
  for (const part of header?.split(';') ?? []) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return undefined;
}
