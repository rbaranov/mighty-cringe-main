import 'fake-indexeddb/auto';

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Exercise, SyncMutation } from '@mighty-cringe/contracts';

import {
  activateLocalUser,
  cacheCurrentUser,
  clearLocalUserData,
  db,
  getCachedCurrentUser,
  getLocalLogoutRisks,
  ownDb,
} from './db';
import {
  getDataContext,
  initializeDataContext,
  invalidateDataContext,
  isDataContextValid,
  setAthleteDataContext,
  setOwnDataContext,
  sportingRequest,
} from './dataContext';
import { toggleExercisePreference } from './exercisePreferences';
import { softDeletePersonalExercise, updatePersonalExercise } from './exercises';
import {
  flushOutbox,
  queueMutation,
  refreshExercisePreferences,
  refreshHistory,
  syncAll,
} from './sync';

const actorId = '10000000-0000-4000-8000-000000000001';
const athleteId = '10000000-0000-4000-8000-000000000002';
const exerciseId = '20000000-0000-4000-8000-000000000001';
const databases = new Set([ownDb]);
let linkSequence = 0;

function enterAthlete() {
  const context = setAthleteDataContext({
    actorId,
    athleteId,
    relationshipId: `link-${++linkSequence}`,
  });
  databases.add(context.database);
  return context;
}

const exercise: Exercise = {
  id: exerciseId,
  nameRu: 'Упражнение',
  nameEn: 'Exercise',
  aliases: [],
  tag: 'normal',
  primaryMuscles: ['back'],
  secondaryMuscles: [],
  equipment: [],
  scope: 'user',
};
const mutation: SyncMutation = {
  type: 'exercise.create',
  payload: {
    ...exercise,
    videos: [],
    sources: [],
    notes: null,
    clientMutationId: '30000000-0000-4000-8000-000000000001',
  },
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

beforeEach(async () => {
  vi.unstubAllGlobals();
  initializeDataContext(actorId);
  setOwnDataContext();
  await ownDb.transaction('rw', ownDb.tables, async () => {
    await Promise.all(ownDb.tables.map((table) => table.clear()));
  });
  vi.stubGlobal('navigator', { onLine: false });
  vi.stubGlobal('window', new EventTarget());
});

afterAll(async () => {
  vi.unstubAllGlobals();
  invalidateDataContext();
  await Promise.all([...databases].map((database) => database.delete()));
});

describe('trainer data ownership', () => {
  it('isolates sporting stores and preserves the actor session and own durable outbox', async () => {
    await activateLocalUser(actorId);
    const user = {
      id: actorId,
      displayName: 'Coach',
      email: 'coach@example.com',
      avatarUrl: null,
      role: 'trainer' as const,
      locale: 'ru' as const,
      unitSystem: 'metric' as const,
    };
    await cacheCurrentUser(user);
    const own = getDataContext();
    await queueMutation(mutation, own);
    await ownDb.exercises.put(exercise);
    const athlete = enterAthlete();
    expect(db).toBe(athlete.database);
    expect(await db.exercises.count()).toBe(0);
    expect(await db.outbox.count()).toBe(0);
    expect(await getCachedCurrentUser()).toEqual(user);
    expect(initializeDataContext(actorId)).toBe(athlete);
    expect(setOwnDataContext()).toBe(own);
    expect(await db.exercises.count()).toBe(1);
    expect(await db.outbox.count()).toBe(1);
  });

  it('keeps an async local write and its queued mutation in the scope captured before switching', async () => {
    const athlete = enterAthlete();
    const pending = toggleExercisePreference(exerciseId, 'like');
    setOwnDataContext();
    await pending;
    expect(await ownDb.exercisePreferences.count()).toBe(0);
    expect(await ownDb.outbox.count()).toBe(0);
    expect(await athlete.database.exercisePreferences.get(exerciseId)).toMatchObject({
      value: 'like',
    });
    expect(await athlete.database.outbox.count()).toBe(1);
  });

  it('applies a late sync acknowledgement only to its original owner and relationship', async () => {
    const athlete = enterAthlete();
    await queueMutation(mutation, athlete);
    const reply = deferred<Response>();
    const sent = deferred<void>();
    const request = vi.fn<typeof fetch>(async () => {
      sent.resolve();
      return reply.promise;
    });
    vi.stubGlobal('fetch', request);
    vi.stubGlobal('navigator', { onLine: true });
    const pending = flushOutbox(athlete);
    await sent.promise;
    setOwnDataContext();
    reply.resolve(Response.json({ entityType: 'exercise', entity: exercise, duplicate: false }));
    await expect(pending).resolves.toBe('success');
    const headers = new Headers(request.mock.calls[0]?.[1]?.headers);
    expect(headers.get('X-Actor-Id')).toBe(actorId);
    expect(headers.get('X-Athlete-Id')).toBe(athleteId);
    expect(headers.get('X-Trainer-Link-Id')).toBe(athlete.relationshipId);
    expect(await ownDb.exercises.count()).toBe(0);
    expect(await ownDb.meta.get('lastSuccessfulSyncAt')).toBeUndefined();
    expect(await athlete.database.exercises.get(exerciseId)).toMatchObject({ syncState: 'synced' });
    expect(await athlete.database.outbox.count()).toBe(0);
  });

  it('keeps a revoked queue durable and never replays it under a new relationship', async () => {
    const athlete = enterAthlete();
    await queueMutation(mutation, athlete);
    const events: Event[] = [];
    window.addEventListener('mighty-cringe:trainer-access-revoked', (event) => events.push(event));
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        Response.json(
          { error: 'Access unavailable', code: 'trainer_access_revoked' },
          { status: 403 },
        ),
      );
    vi.stubGlobal('fetch', request);
    vi.stubGlobal('navigator', { onLine: true });
    await expect(flushOutbox(athlete)).resolves.toBe('forbidden');
    expect(isDataContextValid(athlete)).toBe(false);
    expect(events).toHaveLength(1);
    expect(await athlete.database.outbox.count()).toBe(1);
    await expect(flushOutbox(athlete)).resolves.toBe('forbidden');
    const nextLink = enterAthlete();
    expect(await nextLink.database.outbox.count()).toBe(0);
    await expect(flushOutbox(nextLink)).resolves.toBe('success');
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('does not let a late response restore an invalidated account cache', async () => {
    const own = getDataContext();
    const reply = deferred<Response>();
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(() => reply.promise),
    );
    const pending = refreshExercisePreferences(own);
    invalidateDataContext();
    reply.resolve(
      Response.json({
        items: [{ exerciseId, value: 'like', revision: 1, updatedAt: new Date().toISOString() }],
      }),
    );
    await pending;
    expect(await ownDb.exercisePreferences.count()).toBe(0);
  });

  it('strips owner headers from self requests and rejects old actor scopes before network access', async () => {
    const own = getDataContext();
    const request = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ items: [] }));
    vi.stubGlobal('fetch', request);
    await sportingRequest(
      '/api/v1/exercises',
      {
        headers: {
          'X-Actor-Id': 'forged',
          'X-Athlete-Id': athleteId,
          'X-Trainer-Link-Id': 'stale',
        },
      },
      own,
    );
    expect(new Headers(request.mock.calls[0]?.[1]?.headers).get('X-Actor-Id')).toBe(actorId);
    expect(new Headers(request.mock.calls[0]?.[1]?.headers).has('X-Athlete-Id')).toBe(false);
    initializeDataContext('other-actor');
    await expect(sportingRequest('/api/v1/exercises', {}, own)).rejects.toThrow(
      'data_context_unavailable',
    );
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('serializes a new queued write after the in-flight refresh for that owner', async () => {
    const athlete = enterAthlete();
    const historyReply = deferred<Response>();
    const enteredHistory = deferred<void>();
    const request = vi.fn<typeof fetch>(async (input) => {
      if (input === '/api/v1/workouts') {
        enteredHistory.resolve();
        return historyReply.promise;
      }
      if (input === '/api/v1/sync')
        return Response.json({ entityType: 'exercise', entity: exercise, duplicate: false });
      return Response.json({ items: [] });
    });
    vi.stubGlobal('fetch', request);
    vi.stubGlobal('navigator', { onLine: true });
    const refresh = refreshHistory(athlete);
    await enteredHistory.promise;
    // Queue offline to avoid an unrelated zero-delay auto-flush timer in this test.
    vi.stubGlobal('navigator', { onLine: false });
    await queueMutation(mutation, athlete);
    vi.stubGlobal('navigator', { onLine: true });
    const flush = flushOutbox(athlete);
    expect(request.mock.calls.some(([url]) => url === '/api/v1/sync')).toBe(false);
    historyReply.resolve(Response.json({ items: [] }));
    await expect(refresh).resolves.toBe('success');
    await expect(flush).resolves.toBe('success');
    expect(await athlete.database.exercises.get(exerciseId)).toMatchObject({ syncState: 'synced' });
  });

  it('deduplicates full refreshes while the same owner is already synchronizing', async () => {
    const athlete = enterAthlete();
    const reply = deferred<Response>();
    const request = vi.fn<typeof fetch>(() => reply.promise.then((response) => response.clone()));
    vi.stubGlobal('fetch', request);
    vi.stubGlobal('navigator', { onLine: true });
    const first = syncAll(athlete);
    expect(syncAll(athlete)).toBe(first);
    reply.resolve(Response.json({ items: [] }));
    await expect(first).resolves.toBe('success');
    expect(request).toHaveBeenCalledTimes(4);
  });

  it('purges athlete caches on account logout and invalidates their pending callbacks', async () => {
    const athlete = enterAthlete();
    await queueMutation(mutation, athlete);
    const name = athlete.database.name;
    await clearLocalUserData();
    expect(isDataContextValid(athlete)).toBe(false);
    // Dexie has closed and deleted the scoped database, rather than merely clearing the UI.
    const names = await (await import('dexie')).default.getDatabaseNames();
    expect(names).not.toContain(name);
    expect(db).toBe(ownDb);
  });

  it('sends the editor revision even when polling has already cached a newer exercise', async () => {
    const athlete = enterAthlete();
    await athlete.database.exercises.put({ ...exercise, revision: 3 });
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        Response.json(
          { code: 'revision_conflict', current: { ...exercise, revision: 3 } },
          { status: 409 },
        ),
      );
    vi.stubGlobal('fetch', request);
    await expect(
      updatePersonalExercise(
        exerciseId,
        { ...exercise, videos: [], sources: [], notes: null },
        athlete,
        2,
      ),
    ).rejects.toThrow('exercise_revision_conflict');
    expect(new Headers(request.mock.calls[0]?.[1]?.headers).get('If-Match')).toBe('2');
    expect(await athlete.database.exercises.get(exerciseId)).toMatchObject({ revision: 3 });
  });

  it('refuses an unversioned athlete exercise deletion before sending it', async () => {
    const athlete = enterAthlete();
    await athlete.database.exercises.put(exercise);
    const request = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', request);
    await expect(softDeletePersonalExercise(exerciseId, athlete)).rejects.toThrow(
      'exercise_revision_required',
    );
    expect(request).not.toHaveBeenCalled();
  });

  it('warns about pending work in inactive athlete and historical grant databases before logout', async () => {
    const own = getDataContext();
    await queueMutation(mutation, own);
    const firstGrant = enterAthlete();
    await queueMutation(mutation, firstGrant);
    const secondGrant = enterAthlete();
    await queueMutation(mutation, secondGrant);
    setOwnDataContext();
    expect(await getLocalLogoutRisks()).toMatchObject({ pendingMutations: 3, conflicts: 0 });
  });

  it('halts the old actor queue when another browser tab changes the authenticated cookie', async () => {
    const own = getDataContext();
    await queueMutation(mutation, own);
    const unauthorized = vi.fn();
    window.addEventListener('mighty-cringe:unauthorized', unauthorized);
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        Response.json(
          { code: 'actor_session_changed', error: 'Account changed in another tab' },
          { status: 403 },
        ),
      );
    vi.stubGlobal('fetch', request);
    vi.stubGlobal('navigator', { onLine: true });
    await expect(flushOutbox(own)).resolves.toBe('forbidden');
    expect(isDataContextValid(own)).toBe(false);
    expect(unauthorized).toHaveBeenCalledOnce();
    expect(await ownDb.outbox.count()).toBe(1);
    await expect(flushOutbox(own)).resolves.toBe('forbidden');
    expect(request).toHaveBeenCalledOnce();
  });

  it('does not invalidate a newer account because of a late old-actor mismatch response', async () => {
    const own = getDataContext();
    const reply = deferred<Response>();
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(() => reply.promise),
    );
    const unauthorized = vi.fn();
    window.addEventListener('mighty-cringe:unauthorized', unauthorized);
    const pending = sportingRequest('/api/v1/exercises', {}, own);
    const next = initializeDataContext('new-account');
    reply.resolve(Response.json({ code: 'actor_session_changed' }, { status: 403 }));
    await expect(pending).rejects.toThrow('data_context_unavailable');
    expect(getDataContext()).toBe(next);
    expect(isDataContextValid(next)).toBe(true);
    expect(unauthorized).not.toHaveBeenCalled();
  });
});
