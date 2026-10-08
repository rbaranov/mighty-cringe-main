import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { buildApp } from './app.js';
import { MemoryRepository } from './repository.js';

const exerciseId = '10000000-0000-4000-8000-000000000001';

test('one active trainer link manages sporting data, preserves actor identity, and rejects stale links', async (t) => {
  const repository = new MemoryRepository();
  const createUser = (name: string, role: 'athlete' | 'trainer') =>
    repository.upsertGoogleUser(
      { subject: name, email: `${name}@example.test`, displayName: name, avatarUrl: null },
      role,
    );
  const trainer = await createUser('coach', 'trainer');
  const athlete = await createUser('athlete', 'athlete');
  const stranger = await createUser('stranger', 'trainer');
  const coachApp = buildApp(repository, { developmentUser: trainer, logger: false as never });
  const athleteApp = buildApp(repository, { developmentUser: athlete, logger: false as never });
  const strangerApp = buildApp(repository, { developmentUser: stranger, logger: false as never });
  t.after(async () => {
    await Promise.all([coachApp.close(), athleteApp.close(), strangerApp.close()]);
  });

  async function linkAthlete() {
    const tokenHash = randomUUID();
    await repository.createTrainerInvite(
      {
        id: randomUUID(),
        trainerId: trainer.id,
        email: null,
        tokenHash,
        expiresAt: new Date(Date.now() + 60000),
      },
      new Date(),
    );
    return repository.acceptTrainerInvite(tokenHash, athlete.id, athlete.email, new Date());
  }
  const initialLink = await linkAthlete();
  assert.equal(initialLink.access, 'manage');
  coachApp.delete('/api/v1/sets/:setId/no-content', async (_request, reply) =>
    reply.status(204).send(),
  );
  const headers = { 'x-athlete-id': athlete.id, 'x-trainer-link-id': initialLink.linkId };
  const workout = {
    id: randomUUID(),
    clientMutationId: randomUUID(),
    startedAt: new Date().toISOString(),
  };
  assert.equal(
    (await athleteApp.inject({ method: 'POST', url: '/api/v1/workouts', payload: workout }))
      .statusCode,
    201,
  );
  // A different tab may have replaced the shared cookie while an old self journal still has work queued.
  const staleSelfWrite = await athleteApp.inject({
    method: 'POST',
    url: '/api/v1/workouts',
    headers: { 'x-actor-id': trainer.id },
    payload: { ...workout, id: randomUUID(), clientMutationId: randomUUID() },
  });
  assert.equal(staleSelfWrite.statusCode, 403);
  assert.equal(staleSelfWrite.json().code, 'actor_session_changed');
  assert.equal((await repository.listWorkouts(athlete.id)).length, 1);
  assert.equal((await repository.listWorkouts(trainer.id)).length, 0);
  assert.equal(
    (
      await athleteApp.inject({
        method: 'GET',
        url: '/api/v1/workouts',
        headers: { 'x-actor-id': athlete.id },
      })
    ).statusCode,
    200,
  );
  assert.equal(
    (
      await athleteApp.inject({
        method: 'GET',
        url: '/api/v1/workouts',
        headers: { 'x-actor-id': 'invalid' },
      })
    ).statusCode,
    400,
  );
  const history = await coachApp.inject({
    method: 'GET',
    url: '/api/v1/workouts',
    headers: headers,
  });
  assert.equal(history.statusCode, 200);
  assert.equal(history.json().items[0].id, workout.id);
  assert.equal(
    (await coachApp.inject({ method: 'GET', url: '/api/v1/workouts' })).json().items.length,
    0,
  );
  assert.equal(
    (await strangerApp.inject({ method: 'GET', url: '/api/v1/workouts', headers: headers }))
      .statusCode,
    403,
  );
  assert.equal(
    (
      await coachApp.inject({
        method: 'GET',
        url: '/api/v1/workouts',
        headers: { ...headers, 'x-athlete-id': stranger.id },
      })
    ).statusCode,
    403,
  );
  const rejectedLegacyChange = await athleteApp.inject({
    method: 'PATCH',
    url: '/api/v1/trainer/relationship',
    payload: { access: 'read' },
  });
  assert.equal(rejectedLegacyChange.statusCode, 410);
  assert.equal(rejectedLegacyChange.json().code, 'trainer_access_model_changed');
  const relationship = (
    await athleteApp.inject({ method: 'GET', url: '/api/v1/trainer/relationship' })
  ).json().trainer;
  assert.equal(relationship.linkId, initialLink.linkId);
  assert.equal(relationship.access, 'manage');
  const noContent = await coachApp.inject({
    method: 'DELETE',
    url: `/api/v1/sets/${randomUUID()}/no-content`,
    headers,
  });
  assert.equal(noContent.statusCode, 204);
  assert.equal(noContent.body, '');
  const context = await coachApp.inject({
    method: 'GET',
    url: `/api/v1/trainer/athletes/${athlete.id}/context`,
  });
  assert.equal(context.json().athlete.linkId, headers['x-trainer-link-id']);
  const setInput = {
    clientMutationId: randomUUID(),
    workoutId: workout.id,
    set: {
      id: randomUUID(),
      exerciseId,
      reps: 10,
      weightKg: 60,
      rir: null,
      comment: null,
      performedAt: new Date().toISOString(),
    },
  };
  const created = await coachApp.inject({
    method: 'POST',
    url: '/api/v1/sync',
    headers,
    payload: { type: 'set.create', payload: setInput },
  });
  assert.equal(created.statusCode, 201, created.body);
  assert.equal(created.json().entity.entrySource, 'manual');
  assert.equal(
    (await athleteApp.inject({ method: 'GET', url: '/api/v1/workouts' })).json().items[0].sets
      .length,
    1,
  );
  const duplicate = await coachApp.inject({
    method: 'POST',
    url: '/api/v1/sync',
    headers,
    payload: { type: 'set.create', payload: setInput },
  });
  assert.equal(duplicate.json().duplicate, true);
  assert.equal(repository.trainerAudit.at(-1)?.actorId, trainer.id);
  assert.equal(repository.trainerAudit.at(-1)?.athleteId, athlete.id);

  const favorite = await coachApp.inject({
    method: 'PATCH',
    url: `/api/v1/workouts/${workout.id}`,
    headers,
    payload: {
      clientMutationId: randomUUID(),
      baseRevision: 1,
      changes: { isFavorite: true, favoriteName: 'Coach plan' },
    },
  });
  assert.equal(favorite.statusCode, 200, favorite.body);
  assert.equal(favorite.json().entity.isFavorite, true);
  const personal = {
    id: randomUUID(),
    nameRu: 'Жим гантелей сидя',
    nameEn: 'Seated dumbbell press',
    aliases: [],
    tag: 'normal',
    primaryMuscles: ['shoulders'],
    secondaryMuscles: [],
    equipment: ['dumbbell'],
    videos: [],
    sources: [],
    notes: null,
  };
  // Use a catalog muscle value to keep this test independent of display vocabulary.
  const catalog = (
    await coachApp.inject({ method: 'GET', url: '/api/v1/exercises', headers })
  ).json().items;
  personal.primaryMuscles = catalog[0].primaryMuscles;
  const createdExercise = await coachApp.inject({
    method: 'POST',
    url: '/api/v1/exercises',
    headers,
    payload: personal,
  });
  assert.equal(createdExercise.statusCode, 201, createdExercise.body);
  assert.ok(
    (await athleteApp.inject({ method: 'GET', url: '/api/v1/exercises' }))
      .json()
      .items.some((item: { id: string }) => item.id === personal.id),
  );
  assert.ok(
    !(await coachApp.inject({ method: 'GET', url: '/api/v1/exercises' }))
      .json()
      .items.some((item: { id: string }) => item.id === personal.id),
  );
  const coachOnlyExercise = { ...personal, id: randomUUID() };
  assert.equal(
    (
      await coachApp.inject({
        method: 'POST',
        url: '/api/v1/exercises',
        payload: coachOnlyExercise,
      })
    ).statusCode,
    201,
  );
  const foreignExerciseSet = await coachApp.inject({
    method: 'POST',
    url: '/api/v1/sets',
    headers,
    payload: {
      ...setInput,
      clientMutationId: randomUUID(),
      set: { ...setInput.set, id: randomUUID(), exerciseId: coachOnlyExercise.id },
    },
  });
  assert.equal(foreignExerciseSet.statusCode, 404);
  const editHeaders = { ...headers, 'if-match': '1' };
  assert.equal(
    (
      await coachApp.inject({
        method: 'PUT',
        url: `/api/v1/exercises/${personal.id}`,
        headers: editHeaders,
        payload: { ...personal, notes: 'Technique cue' },
      })
    ).statusCode,
    200,
  );
  const staleExercise = await coachApp.inject({
    method: 'PUT',
    url: `/api/v1/exercises/${personal.id}`,
    headers: editHeaders,
    payload: { ...personal, notes: 'Outdated cue' },
  });
  assert.equal(staleExercise.statusCode, 409);
  assert.equal(staleExercise.json().current.revision, 2);
  assert.equal(
    (await coachApp.inject({ method: 'DELETE', url: `/api/v1/exercises/${personal.id}`, headers }))
      .statusCode,
    428,
  );
  const journal = await athleteApp.inject({ method: 'GET', url: '/api/v1/journal-activity' });
  assert.equal(
    journal.json().items.filter((item: { action: string }) => item.action === 'set.create').length,
    1,
  );
  assert.equal(journal.json().items[0].actorDisplayName, trainer.displayName);
  assert.deepEqual(Object.keys(journal.json().items[0]).sort(), [
    'action',
    'actorDisplayName',
    'createdAt',
    'id',
  ]);
  assert.equal(
    (await coachApp.inject({ method: 'GET', url: '/api/v1/journal-activity' })).json().items.length,
    0,
  );
  assert.equal(
    (
      await coachApp.inject({
        method: 'DELETE',
        url: `/api/v1/exercises/${exerciseId}`,
        headers: { ...headers, 'if-match': '1' },
      })
    ).statusCode,
    404,
  );

  for (const url of [
    '/api/v1/me',
    '/api/v1/voice-entries',
    '/api/v1/notifications/preferences',
    '/api/v1/admin/users',
    '/api/v1/trainer/relationship',
  ]) {
    assert.equal((await coachApp.inject({ method: 'GET', url, headers })).statusCode, 403, url);
  }
  assert.equal(
    (await coachApp.inject({ method: 'GET', url: '/api/v1/me' })).json().user.id,
    trainer.id,
  );
  assert.equal(
    (
      await coachApp.inject({
        method: 'PATCH',
        url: '/api/v1/trainer/relationship',
        headers,
        payload: { access: 'manage' },
      })
    ).statusCode,
    403,
  );

  assert.equal(
    (await athleteApp.inject({ method: 'DELETE', url: '/api/v1/trainer/relationship' })).statusCode,
    204,
  );
  const stale = await coachApp.inject({
    method: 'POST',
    url: '/api/v1/sync',
    headers,
    payload: { type: 'set.create', payload: setInput },
  });
  assert.equal(stale.statusCode, 403);
  assert.equal(stale.json().code, 'trainer_access_revoked');
  const newLink = await linkAthlete();
  assert.equal(newLink.access, 'manage');
  assert.notEqual(newLink.linkId, headers['x-trainer-link-id']);
  assert.equal(
    (await coachApp.inject({ method: 'GET', url: '/api/v1/workouts', headers })).statusCode,
    403,
  );
  const reconnected = await coachApp.inject({
    method: 'POST',
    url: '/api/v1/sync',
    headers: { ...headers, 'x-trainer-link-id': newLink.linkId },
    payload: {
      type: 'set.create',
      payload: {
        ...setInput,
        clientMutationId: randomUUID(),
        set: { ...setInput.set, id: randomUUID() },
      },
    },
  });
  assert.equal(reconnected.statusCode, 201, reconnected.body);
});

test('an active pre-migration read link provides full access, but inactive links and removed roles do not', async () => {
  const repository = new MemoryRepository();
  const trainer = await repository.upsertGoogleUser(
    {
      subject: 'legacy-coach',
      email: 'legacy-coach@example.test',
      displayName: 'Coach',
      avatarUrl: null,
    },
    'trainer',
  );
  const athlete = await repository.upsertGoogleUser(
    {
      subject: 'legacy-athlete',
      email: 'legacy-athlete@example.test',
      displayName: 'Athlete',
      avatarUrl: null,
    },
    'athlete',
  );
  const tokenHash = randomUUID();
  await repository.createTrainerInvite(
    {
      id: randomUUID(),
      trainerId: trainer.id,
      email: null,
      tokenHash,
      expiresAt: new Date(Date.now() + 60000),
    },
    new Date(),
  );
  const link = await repository.acceptTrainerInvite(
    tokenHash,
    athlete.id,
    athlete.email,
    new Date(),
  );
  // Simulate the old persisted value before migration. Production has no tier-changing operation.
  const persisted = repository as unknown as {
    trainerLinks: Map<string, { access: 'read' | 'manage'; active: boolean }>;
    users: Map<string, { role: string }>;
  };
  persisted.trainerLinks.get(link.linkId)!.access = 'read';
  assert.equal((await repository.getAthleteTrainer(athlete.id))?.access, 'manage');
  assert.equal((await repository.listTrainerAthletes(trainer.id))[0].access, 'manage');
  const scope = {
    actorId: trainer.id,
    athleteId: athlete.id,
    linkId: link.linkId,
    write: true,
    operation: 'set.create',
    details: {},
  };
  assert.equal(
    await repository.withTrainerAccess(scope, async () => ({ value: true, successful: true })),
    true,
  );
  persisted.users.get(trainer.id)!.role = 'athlete';
  await assert.rejects(
    repository.withTrainerAccess(scope, async () => ({ value: true, successful: true })),
    /Trainer access is no longer available/,
  );
  persisted.users.get(trainer.id)!.role = 'trainer';
  await repository.revokeAthleteTrainer(athlete.id, new Date());
  await assert.rejects(
    repository.withTrainerAccess(scope, async () => ({ value: true, successful: true })),
    /Trainer access is no longer available/,
  );
});
