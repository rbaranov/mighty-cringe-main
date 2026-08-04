import assert from 'node:assert/strict';
import test from 'node:test';

import { buildApp } from './app.js';
import { hashToken } from './auth.js';
import { catalog } from './catalog.js';
import { MemoryRepository } from './repository.js';

test('exercise preferences are authenticated, isolated, idempotent, and revisioned', async () => {
  const repository = new MemoryRepository();
  const now = new Date('2026-08-05T08:00:00.000Z');
  const app = buildApp(repository, { now: () => now });
  const first = await createAthleteSession(repository, 'first', 1);
  const second = await createAthleteSession(repository, 'second', 2);
  const exerciseId = catalog[0]!.id;

  const anonymous = await app.inject({ method: 'GET', url: '/api/v1/exercise-preferences' });
  assert.equal(anonymous.statusCode, 401);

  const firstMutation = {
    type: 'exercise-preference.set',
    payload: {
      clientMutationId: '91000000-0000-4000-8000-000000000001',
      exerciseId,
      value: 'like',
      baseRevision: 0,
    },
  };
  const created = await app.inject({
    method: 'POST',
    url: '/api/v1/sync',
    headers: first.headers,
    payload: firstMutation,
  });
  assert.equal(created.statusCode, 200, created.body);
  assert.deepEqual(created.json().entity, {
    exerciseId,
    value: 'like',
    revision: 1,
    updatedAt: created.json().entity.updatedAt,
  });

  const repeated = await app.inject({
    method: 'POST',
    url: '/api/v1/sync',
    headers: first.headers,
    payload: firstMutation,
  });
  assert.equal(repeated.statusCode, 200, repeated.body);
  assert.equal(repeated.json().duplicate, true);
  assert.equal(repeated.json().entity.revision, 1);

  const secondList = await app.inject({
    method: 'GET',
    url: '/api/v1/exercise-preferences',
    headers: second.headers,
  });
  assert.deepEqual(secondList.json().items, []);

  const changed = await app.inject({
    method: 'POST',
    url: '/api/v1/sync',
    headers: first.headers,
    payload: {
      type: 'exercise-preference.set',
      payload: {
        clientMutationId: '91000000-0000-4000-8000-000000000002',
        exerciseId,
        value: 'dislike',
        baseRevision: 1,
      },
    },
  });
  assert.equal(changed.statusCode, 200, changed.body);
  assert.equal(changed.json().entity.revision, 2);
  assert.equal(changed.json().entity.value, 'dislike');

  const conflict = await app.inject({
    method: 'POST',
    url: '/api/v1/sync',
    headers: first.headers,
    payload: {
      type: 'exercise-preference.set',
      payload: {
        clientMutationId: '91000000-0000-4000-8000-000000000003',
        exerciseId,
        value: 'like',
        baseRevision: 1,
      },
    },
  });
  assert.equal(conflict.statusCode, 409, conflict.body);
  assert.equal(conflict.json().current.value, 'dislike');
  assert.equal(conflict.json().current.revision, 2);

  const cleared = await app.inject({
    method: 'POST',
    url: '/api/v1/sync',
    headers: first.headers,
    payload: {
      type: 'exercise-preference.set',
      payload: {
        clientMutationId: '91000000-0000-4000-8000-000000000004',
        exerciseId,
        value: null,
        baseRevision: 2,
      },
    },
  });
  assert.equal(cleared.statusCode, 200, cleared.body);
  assert.equal(cleared.json().entity.value, null);
  assert.equal(cleared.json().entity.revision, 3);

  const invalid = await app.inject({
    method: 'POST',
    url: '/api/v1/sync',
    headers: first.headers,
    payload: {
      type: 'exercise-preference.set',
      payload: {
        clientMutationId: '91000000-0000-4000-8000-000000000005',
        exerciseId,
        value: 'maybe',
        baseRevision: 3,
      },
    },
  });
  assert.equal(invalid.statusCode, 400);

  await repository.createExercise(second.userId, {
    id: '92000000-0000-4000-8000-000000000001',
    nameRu: 'Личное упражнение второго спортсмена',
    nameEn: 'Second athlete personal exercise',
    aliases: [],
    tag: 'normal',
    primaryMuscles: ['back'],
    secondaryMuscles: [],
    equipment: [],
    videos: [],
    sources: [],
    notes: null,
  });
  const foreign = await app.inject({
    method: 'POST',
    url: '/api/v1/sync',
    headers: first.headers,
    payload: {
      type: 'exercise-preference.set',
      payload: {
        clientMutationId: '91000000-0000-4000-8000-000000000006',
        exerciseId: '92000000-0000-4000-8000-000000000001',
        value: 'like',
        baseRevision: 0,
      },
    },
  });
  assert.equal(foreign.statusCode, 404);

  const firstList = await app.inject({
    method: 'GET',
    url: '/api/v1/exercise-preferences',
    headers: first.headers,
  });
  assert.deepEqual(
    firstList.json().items.map((item: { exerciseId: string; value: string | null }) => ({
      exerciseId: item.exerciseId,
      value: item.value,
    })),
    [{ exerciseId, value: null }],
  );

  await app.close();
  await repository.close();
});

async function createAthleteSession(repository: MemoryRepository, label: string, index: number) {
  const user = await repository.upsertGoogleUser(
    {
      subject: `exercise-preference-${label}`,
      email: `${label}@example.com`,
      displayName: `${label} athlete`,
      avatarUrl: null,
    },
    'athlete',
  );
  const token = `exercise-preference-${label}-session`;
  await repository.createSession({
    id: `93000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    tokenHash: hashToken(token),
    userId: user.id,
    expiresAt: new Date('2026-08-06T08:00:00.000Z'),
  });
  return { userId: user.id, headers: { cookie: `mc_session=${token}` } };
}
