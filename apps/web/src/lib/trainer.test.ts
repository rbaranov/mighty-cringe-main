import { describe, expect, it, vi } from 'vitest';

import { acceptTrainerInviteFromUrl, currentLoginReturnTo } from './trainer';

describe('trainer invitation client boundary', () => {
  it('preserves an invite through Google sign-in', () => {
    expect(
      currentLoginReturnTo({ pathname: '/', search: '?trainerInvite=secret-token' } as Location),
    ).toBe('/?trainerInvite=secret-token');
  });

  it('accepts the token in a request body and returns a URL with the token removed', async () => {
    const request = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(init?.body).toBe(JSON.stringify({ token: 'abcdefghijklmnopqrstuvwxyz_123456' }));
      return Response.json({
        trainer: {
          id: '10000000-0000-4000-8000-000000000001',
          displayName: 'Тренер',
          avatarUrl: null,
        },
      });
    });
    const result = await acceptTrainerInviteFromUrl(
      'https://mightycringe.com/?trainerInvite=abcdefghijklmnopqrstuvwxyz_123456&from=share',
      request,
    );
    expect(result?.trainer.displayName).toBe('Тренер');
    expect(result?.cleanUrl).toBe('/?from=share');
  });
});
