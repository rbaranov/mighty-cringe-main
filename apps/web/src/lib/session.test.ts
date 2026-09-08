import { describe, expect, it, vi } from 'vitest';

import type { CurrentUser } from '@mighty-cringe/contracts';

import { resolveSession } from './session';

const user: CurrentUser = {
  id: '10000000-0000-4000-8000-000000000001',
  email: 'athlete@example.com',
  displayName: 'Athlete',
  avatarUrl: null,
  role: 'athlete',
  locale: 'ru',
  unitSystem: 'metric',
};

describe('offline session resolution', () => {
  it('uses a validated server session when the API is reachable', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ user }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const getCachedUser = vi.fn().mockResolvedValue(null);

    await expect(resolveSession({ request, getCachedUser })).resolves.toEqual({
      status: 'authenticated',
      user,
      source: 'server',
    });
    expect(getCachedUser).not.toHaveBeenCalled();
  });

  it('restores the last confirmed user when the API cannot be reached', async () => {
    const request = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('offline'));

    await expect(resolveSession({ request, getCachedUser: async () => user })).resolves.toEqual({
      status: 'authenticated',
      user,
      source: 'cache',
    });
  });

  it('does not bypass a definitive 401 with the cached user', async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ googleEnabled: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    const getCachedUser = vi.fn().mockResolvedValue(user);

    await expect(resolveSession({ request, getCachedUser })).resolves.toEqual({
      status: 'anonymous',
      googleEnabled: true,
      serverRejected: true,
      serverUnavailable: false,
    });
    expect(getCachedUser).not.toHaveBeenCalled();
  });

  it('stays signed out offline when no confirmed session is cached', async () => {
    const request = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('offline'));

    await expect(resolveSession({ request, getCachedUser: async () => null })).resolves.toEqual({
      status: 'anonymous',
      googleEnabled: false,
      serverRejected: false,
      serverUnavailable: true,
    });
  });

  it('restores the confirmed user when an Android resume leaves the session request pending', async () => {
    vi.useFakeTimers();
    try {
      const request = vi.fn<typeof fetch>().mockImplementation(
        (_input, init) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted')));
          }),
      );
      const resolution = resolveSession({
        request,
        getCachedUser: async () => user,
        timeoutMs: 250,
      });

      await vi.advanceTimersByTimeAsync(250);

      await expect(resolution).resolves.toEqual({
        status: 'authenticated',
        user,
        source: 'cache',
      });
      expect(request).toHaveBeenCalledWith(
        '/api/v1/me',
        expect.objectContaining({ credentials: 'same-origin', signal: expect.any(AbortSignal) }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('finishes signed-out startup when the optional auth config request stalls', async () => {
    vi.useFakeTimers();
    try {
      const request = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(new Response(null, { status: 401 }))
        .mockImplementationOnce(
          (_input, init) =>
            new Promise<Response>((_resolve, reject) => {
              init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted')));
            }),
        );
      const resolution = resolveSession({
        request,
        getCachedUser: async () => null,
        timeoutMs: 250,
      });

      await vi.advanceTimersByTimeAsync(250);

      await expect(resolution).resolves.toEqual({
        status: 'anonymous',
        googleEnabled: false,
        serverRejected: true,
        serverUnavailable: true,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not wait forever when the session response body stalls', async () => {
    vi.useFakeTimers();
    try {
      const stalledResponse = new Response(null, { status: 200 });
      vi.spyOn(stalledResponse, 'json').mockImplementation(() => new Promise<never>(() => {}));
      const request = vi.fn<typeof fetch>().mockResolvedValue(stalledResponse);
      const resolution = resolveSession({
        request,
        getCachedUser: async () => user,
        timeoutMs: 250,
      });

      await vi.advanceTimersByTimeAsync(250);

      await expect(resolution).resolves.toEqual({
        status: 'authenticated',
        user,
        source: 'cache',
      });
    } finally {
      vi.useRealTimers();
    }
  });
});
