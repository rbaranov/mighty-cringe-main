import type { CurrentUser } from '@mighty-cringe/contracts';

import { parseCurrentUser } from './user';

export type SessionResolution =
  | { status: 'authenticated'; user: CurrentUser; source: 'server' | 'cache' }
  | { status: 'anonymous'; googleEnabled: boolean; serverRejected: boolean };

export async function resolveSession({
  request,
  getCachedUser,
}: {
  request: typeof fetch;
  getCachedUser: () => Promise<CurrentUser | null>;
}): Promise<SessionResolution> {
  let response: Response;
  try {
    response = await request('/api/v1/me', { credentials: 'same-origin' });
  } catch {
    return cachedSession(getCachedUser);
  }

  if (response.ok) {
    try {
      const payload = (await response.json()) as { user?: unknown };
      const user = parseCurrentUser(payload.user);
      if (user) return { status: 'authenticated', user, source: 'server' };
    } catch {
      // A malformed response is treated like a temporarily unavailable API.
    }
    return cachedSession(getCachedUser);
  }

  if (response.status !== 401) return cachedSession(getCachedUser);

  let googleEnabled = false;
  try {
    const configResponse = await request('/api/v1/auth/config', { credentials: 'same-origin' });
    if (configResponse.ok) {
      const config = (await configResponse.json()) as { googleEnabled?: unknown };
      googleEnabled = config.googleEnabled === true;
    }
  } catch {
    // Authentication was rejected by the server already; config is only presentational.
  }
  return { status: 'anonymous', googleEnabled, serverRejected: true };
}

async function cachedSession(
  getCachedUser: () => Promise<CurrentUser | null>,
): Promise<SessionResolution> {
  const user = await getCachedUser();
  return user
    ? { status: 'authenticated', user, source: 'cache' }
    : { status: 'anonymous', googleEnabled: false, serverRejected: false };
}
