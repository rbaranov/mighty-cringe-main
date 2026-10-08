import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  getDataContext,
  initializeDataContext,
  setAthleteDataContext,
  setOwnDataContext,
} from './dataContext';

import {
  acceptTrainerInviteFromUrl,
  currentLoginReturnTo,
  getTrainerAthleteContext,
  createTrainerInvite,
  revokeTrainerRelationship,
} from './trainer';

const actorId = '10000000-0000-4000-8000-000000000001';

beforeEach(() => {
  initializeDataContext(actorId);
  setOwnDataContext();
});

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

describe('trainer journal connection', () => {
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

  it('disconnects the whole relationship with one actor-scoped DELETE request', async () => {
    const request = vi.fn(
      async (_input: string | URL | Request, _init?: RequestInit) =>
        new Response(null, { status: 204 }),
    );
    await revokeTrainerRelationship(request);
    expect(request).toHaveBeenCalledWith(
      '/api/v1/trainer/relationship',
      expect.objectContaining({ method: 'DELETE', credentials: 'include' }),
    );
    const init = request.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(new Headers(init?.headers).get('X-Actor-Id')).toBe(actorId);
    expect(init?.body).toBeUndefined();
  });

  it('explains revoked access instead of claiming a successful switch', async () => {
    const request = vi.fn(async () =>
      Response.json({ code: 'trainer_access_revoked' }, { status: 403 }),
    );
    await expect(getTrainerAthleteContext('athlete', request)).rejects.toThrow(
      'Подопечный отозвал доступ',
    );
  });

  it('keeps trainer-account operations scoped to the actor while an athlete journal is selected', async () => {
    setAthleteDataContext({ actorId, athleteId: 'athlete-id', relationshipId: 'link-id' });
    const request = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) =>
      Response.json({ invite: {}, token: 'invite-token' }),
    );
    await createTrainerInvite('athlete@example.test', request);
    const headers = new Headers(request.mock.calls[0]?.[1]?.headers);
    expect(headers.get('X-Actor-Id')).toBe(actorId);
    expect(headers.has('X-Athlete-Id')).toBe(false);
    expect(headers.has('X-Trainer-Link-Id')).toBe(false);
  });

  it('invalidates the local actor when another tab changed the session cookie', async () => {
    const request = vi.fn(async () =>
      Response.json({ code: 'actor_session_changed' }, { status: 403 }),
    );
    await expect(revokeTrainerRelationship(request)).rejects.toThrow('Сессия аккаунта изменилась');
    expect(getDataContext().actorId).toBe('');
  });

  it('does not return a prior actor’s relationship from a delayed response body', async () => {
    let deliver!: (value: unknown) => void;
    let bodyStarted!: () => void;
    const reading = new Promise<void>((resolve) => {
      bodyStarted = resolve;
    });
    const body = new Promise<unknown>((resolve) => {
      deliver = resolve;
    });
    const response = Response.json({});
    vi.spyOn(response, 'json').mockImplementation(() => {
      bodyStarted();
      return body;
    });
    const pending = getTrainerAthleteContext(
      'athlete',
      vi.fn(async () => response),
    );
    await reading;
    initializeDataContext('next-actor');
    deliver({ athlete: { displayName: 'Private athlete' } });
    await expect(pending).rejects.toThrow('data_context_unavailable');
  });
});
