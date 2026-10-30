const API_BASE = '/api';

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

// The server never polls the database on its own schedule for channel/profile/image/config changes
// made here — it expects the UI to say when something it needs to reload has changed. Rather than
// remembering to call /system/reload from every mutation's call site, every non-GET request to a
// reload-relevant path triggers it here, once, right after the mutation succeeds. (Changes from
// the ERP sync reload on the server by themselves.) The reload isn't awaited: it restarts channel
// loops and refreshes the match cache, which can take many seconds, and the change is already
// saved - so the caller (e.g. a modal waiting to close) shouldn't wait for it to take effect.
function isReloadRelevant(method: string, path: string): boolean {
  if (method === 'GET' || path === '/system/reload') return false;
  if (
    path.endsWith('/verify') ||
    path.endsWith('/analyze-frame') ||
    path.endsWith('/default')
  ) {
    return false;
  }
  return (
    path.startsWith('/video-feed-sources') ||
    path.startsWith('/monitoring-profiles') ||
    // includeTestProfilesInAlerts changes which profiles are in the live match set.
    path.startsWith('/configuration')
  );
}

async function triggerReload() {
  try {
    await fetch(`${API_BASE}/system/reload`, { method: 'POST' });
  } catch (error) {
    console.error(
      'Failed to notify the server to reload channel/profile state:',
      error,
    );
  }
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const method = options?.method ?? 'GET';
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers:
      options?.body && !(options.body instanceof FormData)
        ? { 'Content-Type': 'application/json', ...options.headers }
        : options?.headers,
  });

  if (response.status === 204) {
    if (response.ok && isReloadRelevant(method, path)) void triggerReload();
    return undefined as T;
  }

  const isJson = response.headers
    .get('content-type')
    ?.includes('application/json');
  const body = isJson ? await response.json() : undefined;

  if (!response.ok) {
    const message =
      (body && (body.message || body.error)) || response.statusText;
    throw new ApiError(
      typeof message === 'string' ? message : JSON.stringify(message),
      response.status,
    );
  }

  if (isReloadRelevant(method, path)) void triggerReload();

  return body as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, {
      method: 'POST',
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, {
      method: 'PATCH',
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
  postForm: <T>(path: string, formData: FormData) =>
    request<T>(path, { method: 'POST', body: formData }),
};
