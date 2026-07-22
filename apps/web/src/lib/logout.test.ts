import { describe, expect, it, vi } from 'vitest';

import { hasPendingRemoteLogout, requestRemoteLogout } from './logout';

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    removeItem: (key: string) => values.delete(key),
    setItem: (key: string, value: string) => values.set(key, value),
  };
}

describe('remote logout', () => {
  it('keeps a durable pending marker while the server is unreachable', async () => {
    const storage = memoryStorage();
    const request = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('offline'));

    await expect(requestRemoteLogout({ request, storage })).resolves.toBe(false);
    expect(hasPendingRemoteLogout(storage)).toBe(true);
  });

  it('retries and clears the marker after the server confirms logout', async () => {
    const storage = memoryStorage();
    await requestRemoteLogout({
      request: vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 503 })),
      storage,
    });

    await expect(
      requestRemoteLogout({
        request: vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 })),
        storage,
      }),
    ).resolves.toBe(true);
    expect(hasPendingRemoteLogout(storage)).toBe(false);
  });

  it('treats an already expired server session as logged out', async () => {
    const storage = memoryStorage();
    await requestRemoteLogout({
      request: vi.fn<typeof fetch>().mockRejectedValue(new TypeError('offline')),
      storage,
    });

    await expect(
      requestRemoteLogout({
        request: vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 401 })),
        storage,
      }),
    ).resolves.toBe(true);
    expect(hasPendingRemoteLogout(storage)).toBe(false);
  });
});
