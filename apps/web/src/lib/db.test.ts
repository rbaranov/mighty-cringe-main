import 'fake-indexeddb/auto';

import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import type { CurrentUser } from '@mighty-cringe/contracts';

import {
  activateLocalUser,
  cacheCurrentUser,
  clearLocalUserData,
  db,
  disableOfflineSession,
  getCachedCurrentUser,
} from './db';

const athlete: CurrentUser = {
  id: '10000000-0000-4000-8000-000000000001',
  email: 'athlete@example.com',
  displayName: 'Athlete',
  avatarUrl: null,
  role: 'athlete',
  locale: 'ru',
};

describe('local user boundary', () => {
  beforeEach(async () => clearLocalUserData());
  afterAll(async () => db.delete());

  it('restores only a profile confirmed for the active local user', async () => {
    await cacheCurrentUser(athlete);
    expect(await getCachedCurrentUser()).toBeNull();

    await activateLocalUser(athlete.id);
    await cacheCurrentUser(athlete);
    expect(await getCachedCurrentUser()).toEqual(athlete);
  });

  it('disables offline access after a definitive session rejection without deleting data', async () => {
    await activateLocalUser(athlete.id);
    await cacheCurrentUser(athlete);
    await db.meta.put({ key: 'pendingEvidence', value: 'preserved' });

    await disableOfflineSession();

    expect(await getCachedCurrentUser()).toBeNull();
    expect((await db.meta.get('pendingEvidence'))?.value).toBe('preserved');
  });

  it('clears the previous owner boundary before activating another user', async () => {
    await activateLocalUser(athlete.id);
    await cacheCurrentUser(athlete);
    await db.meta.put({ key: 'lastSuccessfulSyncAt', value: new Date().toISOString() });

    await activateLocalUser('20000000-0000-4000-8000-000000000002');

    expect(await getCachedCurrentUser()).toBeNull();
    expect(await db.meta.get('lastSuccessfulSyncAt')).toBeUndefined();
  });

  it('keeps an unfinished workout and confirmed profile across a PWA restart', async () => {
    await activateLocalUser(athlete.id);
    await cacheCurrentUser(athlete);
    await db.workouts.put({
      id: '30000000-0000-4000-8000-000000000001',
      startedAt: '2026-07-22T05:00:00.000Z',
      endedAt: null,
      notes: null,
      locale: 'ru',
      exercises: [],
      revision: 0,
      updatedAt: '2026-07-22T05:00:00.000Z',
      syncState: 'pending',
    });

    db.close();
    await db.open();

    expect(await getCachedCurrentUser()).toEqual(athlete);
    expect((await db.workouts.toArray()).find((workout) => workout.endedAt === null)).toMatchObject(
      {
        id: '30000000-0000-4000-8000-000000000001',
        syncState: 'pending',
      },
    );
  });
});
