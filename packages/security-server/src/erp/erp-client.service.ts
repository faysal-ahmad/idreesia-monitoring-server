import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Observable, Subject, Subscription } from 'rxjs';
import { ConfigurationService } from '../configuration/configuration.service';
import { ConfigValues } from '../configuration/configuration.schema';

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

interface Connection {
  baseUrl: string;
  username: string;
  password: string;
}

function toConnection(values: ConfigValues): Connection {
  return {
    baseUrl: values.erpUrl.replace(/\/+$/, ''),
    username: values.erpUsername,
    password: values.erpPassword,
  };
}

// Client for the ERP's security-server sync API (see docs/security-server-sync-api.md in
// idreesia-erp). Logs in as the service account from the ERP URL/username/password settings and
// keeps the token until shortly before it expires; a 401 logs in again once.
@Injectable()
export class ErpClientService implements OnModuleDestroy {
  private readonly logger = new Logger(ErpClientService.name);
  private connection: Connection = { baseUrl: '', username: '', password: '' };
  // The settings are loaded once at startup; every check of the connection waits for that, since
  // the services that use this client start up alongside it.
  private readonly loaded: Promise<void>;
  private readonly subscription: Subscription;
  private readonly connectionChanges = new Subject<void>();
  // Emits after the connection settings change, so pending work can be sent straight away.
  readonly connectionChanges$: Observable<void> =
    this.connectionChanges.asObservable();
  private token: { value: string; expiresAt: number } | null = null;
  private pendingLogin: Promise<string> | null = null;

  constructor(configuration: ConfigurationService) {
    this.loaded = configuration.getAll().then((values) => {
      this.connection = toConnection(values);
    });
    this.subscription = configuration.changes$.subscribe((values) => {
      const next = toConnection(values);
      const { baseUrl, username, password } = this.connection;
      if (
        next.baseUrl === baseUrl &&
        next.username === username &&
        next.password === password
      ) {
        return;
      }
      this.connection = next;
      this.token = null;
      this.connectionChanges.next();
    });
  }

  onModuleDestroy() {
    this.subscription.unsubscribe();
  }

  async isConfigured(): Promise<boolean> {
    await this.loaded;
    const { baseUrl, username, password } = this.connection;
    return Boolean(baseUrl && username && password);
  }

  // `path` is relative to /api/security-server. Network failures reject with fetch's own error.
  async request(
    method: string,
    path: string,
    options: RequestOptions = {},
  ): Promise<Response> {
    if (!(await this.isConfigured())) {
      throw new Error(
        'The ERP connection is not configured (ERP URL, username and password on the Configuration page).',
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
    return fetch(`${this.connection.baseUrl}/api/security-server${path}`, {
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
    const { baseUrl, username, password } = this.connection;
    const response = await fetch(`${baseUrl}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
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
    this.logger.log(`Logged in to the ERP as ${username}`);
    return token;
  }
}
