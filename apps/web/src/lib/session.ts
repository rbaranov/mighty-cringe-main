import type { CurrentUser } from '@mighty-cringe/contracts';

import { parseCurrentUser } from './user';

export type SessionResolution =
  | { status: 'authenticated'; user: CurrentUser; source: 'server' | 'cache' }
  | {
      status: 'anonymous';
      googleEnabled: boolean;
      serverRejected: boolean;
      serverUnavailable: boolean;
    };

export const sessionRequestTimeoutMs = 8_000;

export async function resolveSession({
  request,
  getCachedUser,
  timeoutMs = sessionRequestTimeoutMs,
}: {
  request: typeof fetch;
  getCachedUser: () => Promise<CurrentUser | null>;
  timeoutMs?: number;
}): Promise<SessionResolution> {
  let response: Response;
  try {
    response = await requestWithTimeout(
      request,
      '/api/v1/me',
      { credentials: 'same-origin' },
      timeoutMs,
    );
  } catch {
    return cachedSession(getCachedUser, true);
  }

  if (response.ok) {
    try {
      const payload = (await readJsonWithTimeout(response, timeoutMs)) as { user?: unknown };
      const user = parseCurrentUser(payload.user);
      if (user) return { status: 'authenticated', user, source: 'server' };
    } catch {
      // A malformed response is treated like a temporarily unavailable API.
    }
    return cachedSession(getCachedUser, true);
  }

  if (response.status !== 401) return cachedSession(getCachedUser, true);

  let googleEnabled = false;
  let serverUnavailable = false;
  try {
    const configResponse = await requestWithTimeout(
      request,
      '/api/v1/auth/config',
      { credentials: 'same-origin' },
      timeoutMs,
    );
    if (configResponse.ok) {
      const config = (await readJsonWithTimeout(configResponse, timeoutMs)) as {
        googleEnabled?: unknown;
      };
      googleEnabled = config.googleEnabled === true;
    } else {
      serverUnavailable = true;
    }
  } catch {
    // Authentication was rejected by the server already; config is only presentational.
    serverUnavailable = true;
  }
  return { status: 'anonymous', googleEnabled, serverRejected: true, serverUnavailable };
}

async function cachedSession(
  getCachedUser: () => Promise<CurrentUser | null>,
  serverUnavailable: boolean,
): Promise<SessionResolution> {
  const user = await getCachedUser();
  return user
    ? { status: 'authenticated', user, source: 'cache' }
    : {
        status: 'anonymous',
        googleEnabled: false,
        serverRejected: false,
        serverUnavailable,
      };
}

async function requestWithTimeout(
  request: typeof fetch,
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs: number,
) {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      controller.abort();
      reject(new Error('Session request timed out'));
    }, timeoutMs);
  });

  try {
    return await Promise.race([request(input, { ...init, signal: controller.signal }), timedOut]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

async function readJsonWithTimeout(response: Response, timeoutMs: number) {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new Error('Session response timed out')), timeoutMs);
  });

  try {
    return await Promise.race([response.json(), timedOut]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}
