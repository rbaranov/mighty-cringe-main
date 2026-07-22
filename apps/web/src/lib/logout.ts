const pendingRemoteLogoutKey = 'mighty-cringe:pending-remote-logout';

type LogoutStorage = Pick<Storage, 'getItem' | 'removeItem' | 'setItem'>;

export function hasPendingRemoteLogout(storage: LogoutStorage = window.localStorage) {
  try {
    return storage.getItem(pendingRemoteLogoutKey) === '1';
  } catch {
    return false;
  }
}

export async function requestRemoteLogout({
  request = fetch,
  storage = window.localStorage,
}: {
  request?: typeof fetch;
  storage?: LogoutStorage;
} = {}) {
  try {
    const response = await request('/api/v1/auth/logout', {
      method: 'POST',
      credentials: 'same-origin',
    });
    if (response.ok || response.status === 401) {
      removePendingMarker(storage);
      return true;
    }
  } catch {
    // A durable marker keeps the local session closed until the server confirms logout.
  }
  setPendingMarker(storage);
  return false;
}

function setPendingMarker(storage: LogoutStorage) {
  try {
    storage.setItem(pendingRemoteLogoutKey, '1');
  } catch {
    // The local user cache is still cleared by the caller if storage is unavailable.
  }
}

function removePendingMarker(storage: LogoutStorage) {
  try {
    storage.removeItem(pendingRemoteLogoutKey);
  } catch {
    // A stale marker is safe: it only causes another idempotent logout request.
  }
}
