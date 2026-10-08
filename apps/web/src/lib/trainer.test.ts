import { describe, expect, it, vi } from 'vitest';

import {
  acceptTrainerInviteFromUrl,
  currentLoginReturnTo,
  getTrainerAthleteContext,
  updateTrainerRelationshipAccess,
} from './trainer';

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

describe('explicit athlete consent', () => {
  it.each(['manage', 'read'] as const)(
    'updates the signed-in athlete relationship to %s',
    async (access) => {
      const trainer = {
        id: '10000000-0000-4000-8000-000000000001',
        displayName: 'Тренер',
        avatarUrl: null,
        access,
        linkId: '10000000-0000-4000-8000-000000000009',
      };
      const request = vi.fn(async () => Response.json({ trainer }));
      expect(await updateTrainerRelationshipAccess(access, request)).toEqual({ trainer });
      expect(request).toHaveBeenCalledWith(
        '/api/v1/trainer/relationship',
        expect.objectContaining({
          method: 'PATCH',
          credentials: 'include',
          body: JSON.stringify({ access }),
        }),
      );
    },
  );

  it('loads and returns the current relationship token before entering another log', async () => {
    const athlete = {
      id: '10000000-0000-4000-8000-000000000002',
      displayName: 'Дмитрий Иванов',
      avatarUrl: null,
      linkedAt: '2026-10-08T00:00:00.000Z',
      access: 'manage',
      linkId: '10000000-0000-4000-8000-000000000009',
    };
    const request = vi.fn(async () => Response.json({ athlete }));
    expect(await getTrainerAthleteContext(athlete.id, request)).toEqual({ athlete });
    expect(request).toHaveBeenCalledWith(
      `/api/v1/trainer/athletes/${athlete.id}/context`,
      expect.objectContaining({ credentials: 'include' }),
    );
  });

  it('explains revoked and insufficient access instead of claiming a successful switch', async () => {
    const revoked = vi.fn(async () =>
      Response.json({ code: 'trainer_access_revoked' }, { status: 403 }),
    );
    const readOnly = vi.fn(async () =>
      Response.json({ code: 'trainer_manage_required' }, { status: 403 }),
    );
    await expect(getTrainerAthleteContext('athlete', revoked)).rejects.toThrow(
      'Подопечный отозвал доступ',
    );
    await expect(updateTrainerRelationshipAccess('manage', readOnly)).rejects.toThrow(
      'разрешил только просмотр',
    );
  });
});
