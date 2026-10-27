import { Injectable, Logger } from '@nestjs/common';

// The token is renewed this long before the ERP says it expires.
const TOKEN_REFRESH_MARGIN_MS = 24 * 60 * 60 * 1000;
// A hung ERP mustn't stall the sync or the alert push indefinitely. Generous, since an import
// request carries a profile's photos.
const REQUEST_TIMEOUT_MS = 60_000;

// An HTTP error response from the ERP (anything but 2xx and 304).
export class ErpRequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

interface RequestOptions {
  body?: unknown;
  headers?: Record<string, string>;
}

async function readError(response: Response): Promise<string> {
  const text = await response.text();
  try {
    return (JSON.parse(text) as { error?: string }).error ?? text;
  } catch {
    return text;
  }
}

// Client for the ERP's security-server sync API (see docs/security-server-sync-api.md in
// idreesia-erp). Logs in as the service account from ERP_USERNAME/ERP_PASSWORD and keeps the
// token until shortly before it expires; a 401 logs in again once.
@Injectable()
export class ErpClientService {
  private readonly logger = new Logger(ErpClientService.name);
  private readonly baseUrl = (process.env.ERP_URL ?? '').replace(/\/+$/, '');
  private readonly username = process.env.ERP_USERNAME ?? '';
  private readonly password = process.env.ERP_PASSWORD ?? '';
  private token: { value: string; expiresAt: number } | null = null;
  private pendingLogin: Promise<string> | null = null;

  get configured(): boolean {
    return Boolean(this.baseUrl && this.username && this.password);
  }

  // `path` is relative to /api/security-server. Network failures reject with fetch's own error.
  async request(
    method: string,
    path: string,
    options: RequestOptions = {},
  ): Promise<Response> {
    if (!this.configured) {
      throw new Error(
        'The ERP connection is not configured (ERP_URL, ERP_USERNAME, ERP_PASSWORD).',
      );
    }
    let response = await this.send(
      method,
      path,
      options,
      await this.getToken(),
    );
    if (response.status === 401) {
      this.token = null;
      response = await this.send(method, path, options, await this.getToken());
    }
    if (!response.ok && response.status !== 304) {
      throw new ErpRequestError(
        response.status,
        `${method} ${path.split('?')[0]} → ${response.status}: ${await readError(response)}`,
      );
    }
    return response;
  }

  private send(
    method: string,
    path: string,
    { body, headers }: RequestOptions,
    token: string,
  ) {
    return fetch(`${this.baseUrl}/api/security-server${path}`, {
      method,
      headers: {
        Authorization: token,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  }

  private async getToken(): Promise<string> {
    if (
      this.token &&
      this.token.expiresAt - TOKEN_REFRESH_MARGIN_MS > Date.now()
    ) {
      return this.token.value;
    }
    // Concurrent callers share one login.
    this.pendingLogin ??= this.login().finally(() => {
      this.pendingLogin = null;
    });
    return this.pendingLogin;
  }

  private async login(): Promise<string> {
    const response = await fetch(`${this.baseUrl}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: this.username,
        password: this.password,
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new ErpRequestError(
        response.status,
        `ERP login failed → ${response.status}: ${await readError(response)}`,
      );
    }
    const { token, tokenExpires } = (await response.json()) as {
      token: string;
      tokenExpires: string;
    };
    this.token = { value: token, expiresAt: new Date(tokenExpires).getTime() };
    this.logger.log(`Logged in to the ERP as ${this.username}`);
    return token;
  }
}
