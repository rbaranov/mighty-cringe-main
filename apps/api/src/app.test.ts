import assert from 'node:assert/strict';
import test from 'node:test';

import type { AuthOptions, IdentityProvider } from './auth.js';
import { buildApp } from './app.js';
import type { GoogleIdentity } from './repository.js';
import { MemoryRepository } from './repository.js';

class FakeIdentityProvider implements IdentityProvider {
  readonly identities = new Map<string, GoogleIdentity>();

  createAuthorizationUrl(input: { state: string; nonce: string; codeChallenge: string }) {
    const url = new URL('https://accounts.example.test/authorize');
    url.search = new URLSearchParams({
      state: input.state,
      nonce: input.nonce,
      code_challenge: input.codeChallenge,
      code_challenge_method: 'S256',
    }).toString();
    return url.toString();
  }

  async exchangeCode(input: { code: string; codeVerifier: string; expectedNonce: string }) {
    assert.ok(input.codeVerifier.length >= 43);
    assert.ok(input.expectedNonce.length >= 43);
    const identity = this.identities.get(input.code);
    if (!identity) throw new Error('Unknown fake authorization code');
    return identity;
  }
}

test('an explicit development user can use the local API without an OAuth session', async () => {
  const repository = new MemoryRepository();
  const developmentUser = await repository.upsertGoogleUser(
    {
      subject: 'local-demo-athlete',
      email: 'local-athlete@mightycringe.test',
      displayName: 'Local Athlete',
      avatarUrl: null,
    },
    'athlete',
  );
  const app = buildApp(repository, { developmentUser });
  await app.ready();

  const profile = await app.inject({ method: 'GET', url: '/api/v1/me' });

  assert.equal(profile.statusCode, 200);
  assert.deepEqual(profile.json(), { user: developmentUser });
  await app.close();
});

test('OAuth sessions isolate athlete data, support logout, and enforce admin role', async () => {
  const repository = new MemoryRepository();
  const provider = new FakeIdentityProvider();
  provider.identities.set('athlete-one', {
    subject: 'google-athlete-one',
    email: 'one@example.com',
    displayName: 'Athlete One',
    avatarUrl: null,
  });
  provider.identities.set('athlete-two', {
    subject: 'google-athlete-two',
    email: 'two@example.com',
    displayName: 'Athlete Two',
    avatarUrl: null,
  });
  provider.identities.set('admin', {
    subject: 'google-admin',
    email: 'admin@example.com',
    displayName: 'Admin',
    avatarUrl: null,
  });
  provider.identities.set('trainer', {
    subject: 'google-trainer',
    email: 'trainer@example.com',
    displayName: 'Coach',
    avatarUrl: null,
  });
  const auth: AuthOptions = {
    provider,
    adminEmails: new Set(['admin@example.com']),
    trainerEmails: new Set(['trainer@example.com']),
    secureCookies: false,
    sessionTtlMs: 30 * 24 * 60 * 60 * 1_000,
  };
  const app = buildApp(repository, { auth });
  await app.ready();

  const anonymousHistory = await app.inject({ method: 'GET', url: '/api/v1/workouts' });
  assert.equal(anonymousHistory.statusCode, 401);

  const athleteOneCookie = await logIn(app, 'athlete-one');
  const athleteTwoCookie = await logIn(app, 'athlete-two');
  const adminCookie = await logIn(app, 'admin');
  const trainerCookie = await logIn(app, 'trainer');

  const athleteOneProfile = await app.inject({
    method: 'GET',
    url: '/api/v1/me',
    headers: { cookie: athleteOneCookie },
  });
  assert.equal(athleteOneProfile.statusCode, 200);
  assert.equal(athleteOneProfile.json().user.role, 'athlete');

  const adminProfile = await app.inject({
    method: 'GET',
    url: '/api/v1/me',
    headers: { cookie: adminCookie },
  });
  assert.equal(adminProfile.json().user.role, 'admin');
  const trainerProfile = await app.inject({
    method: 'GET',
    url: '/api/v1/me',
    headers: { cookie: trainerCookie },
  });
  assert.equal(trainerProfile.json().user.role, 'trainer');

  const workoutId = '20000000-0000-4000-8000-000000000001';
  const workout = {
    id: workoutId,
    clientMutationId: '30000000-0000-4000-8000-000000000001',
    startedAt: '2026-07-20T08:00:00.000Z',
    locale: 'ru',
    exercises: [
      {
        id: '21000000-0000-4000-8000-000000000001',
        exerciseId: '10000000-0000-4000-8000-000000000001',
        position: 0,
        supersetGroup: 1,
      },
      {
        id: '21000000-0000-4000-8000-000000000002',
        exerciseId: '10000000-0000-4000-8000-000000000002',
        position: 1,
        supersetGroup: 1,
      },
    ],
  };
  const firstWorkout = await app.inject({
    method: 'POST',
    url: '/api/v1/workouts',
    headers: { cookie: athleteOneCookie },
    payload: workout,
  });
  assert.equal(firstWorkout.statusCode, 201);
  const repeatedWorkout = await app.inject({
    method: 'POST',
    url: '/api/v1/workouts',
    headers: { cookie: athleteOneCookie },
    payload: workout,
  });
  assert.equal(repeatedWorkout.statusCode, 200);
  assert.equal(repeatedWorkout.json().duplicate, true);
  assert.equal(repeatedWorkout.json().entity.revision, 1);
  assert.equal(repeatedWorkout.json().entity.exercises.length, 2);

  const set = {
    clientMutationId: '40000000-0000-4000-8000-000000000001',
    workoutId,
    set: {
      id: '50000000-0000-4000-8000-000000000001',
      exerciseId: '10000000-0000-4000-8000-000000000001',
      weightKg: 60,
      reps: 10,
      rir: 2,
      comment: 'Чисто',
      performedAt: '2026-07-20T08:12:00.000Z',
      position: 0,
    },
  };
  const firstSet = await app.inject({
    method: 'POST',
    url: '/api/v1/sets',
    headers: { cookie: athleteOneCookie },
    payload: set,
  });
  assert.equal(firstSet.statusCode, 201);
  assert.equal(firstSet.json().entity.entrySource, 'manual');

  const provenanceRewrite = await app.inject({
    method: 'PATCH',
    url: `/api/v1/sets/${set.set.id}`,
    headers: { cookie: athleteOneCookie },
    payload: {
      clientMutationId: '40000000-0000-4000-8000-000000000099',
      workoutId,
      baseRevision: 1,
      changes: { entrySource: 'voice_ai' },
    },
  });
  assert.equal(provenanceRewrite.statusCode, 400);

  const finishWorkout = await app.inject({
    method: 'POST',
    url: '/api/v1/sync',
    headers: { cookie: athleteOneCookie },
    payload: {
      type: 'workout.update',
      payload: {
        clientMutationId: '30000000-0000-4000-8000-000000000002',
        workoutId,
        baseRevision: 1,
        changes: { endedAt: '2026-07-20T09:00:00.000Z' },
      },
    },
  });
  assert.equal(finishWorkout.statusCode, 200);
  assert.equal(finishWorkout.json().entity.revision, 2);
  assert.equal(finishWorkout.json().entity.endedAt, '2026-07-20T09:00:00.000Z');

  const reorderPlan = await app.inject({
    method: 'POST',
    url: '/api/v1/sync',
    headers: { cookie: athleteOneCookie },
    payload: {
      type: 'workout.update',
      payload: {
        clientMutationId: '30000000-0000-4000-8000-000000000003',
        workoutId,
        baseRevision: 2,
        changes: {
          exercises: [
            { ...workout.exercises[1], position: 0 },
            { ...workout.exercises[0], position: 1 },
          ],
        },
      },
    },
  });
  assert.equal(reorderPlan.statusCode, 200);
  assert.equal(reorderPlan.json().entity.revision, 3);
  assert.equal(reorderPlan.json().entity.exercises[0].id, workout.exercises[1].id);

  const updateSet = await app.inject({
    method: 'POST',
    url: '/api/v1/sync',
    headers: { cookie: athleteOneCookie },
    payload: {
      type: 'set.update',
      payload: {
        clientMutationId: '40000000-0000-4000-8000-000000000002',
        workoutId,
        setId: set.set.id,
        baseRevision: 1,
        changes: { weightKg: 62.5, comment: 'Исправлено' },
      },
    },
  });
  assert.equal(updateSet.statusCode, 200);
  assert.equal(updateSet.json().entity.revision, 2);
  assert.equal(updateSet.json().entity.weightKg, 62.5);

  const repeatedSetUpdate = await app.inject({
    method: 'POST',
    url: '/api/v1/sync',
    headers: { cookie: athleteOneCookie },
    payload: {
      type: 'set.update',
      payload: {
        clientMutationId: '40000000-0000-4000-8000-000000000002',
        workoutId,
        setId: set.set.id,
        baseRevision: 1,
        changes: { weightKg: 62.5, comment: 'Исправлено' },
      },
    },
  });
  assert.equal(repeatedSetUpdate.statusCode, 200);
  assert.equal(repeatedSetUpdate.json().duplicate, true);
  assert.equal(repeatedSetUpdate.json().entity.revision, 2);

  const staleSetUpdate = await app.inject({
    method: 'POST',
    url: '/api/v1/sync',
    headers: { cookie: athleteOneCookie },
    payload: {
      type: 'set.update',
      payload: {
        clientMutationId: '40000000-0000-4000-8000-000000000003',
        workoutId,
        setId: set.set.id,
        baseRevision: 1,
        changes: { weightKg: 65 },
      },
    },
  });
  assert.equal(staleSetUpdate.statusCode, 409);
  assert.equal(staleSetUpdate.json().code, 'revision_conflict');
  assert.equal(staleSetUpdate.json().current.weightKg, 62.5);

  const deletedSet = {
    ...set,
    clientMutationId: '40000000-0000-4000-8000-000000000004',
    set: {
      ...set.set,
      id: '50000000-0000-4000-8000-000000000002',
      performedAt: '2026-07-20T08:15:00.000Z',
      position: 1,
    },
  };
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: '/api/v1/sets',
        headers: { cookie: athleteOneCookie },
        payload: deletedSet,
      })
    ).statusCode,
    201,
  );
  const deleteMutation = {
    type: 'set.delete',
    payload: {
      clientMutationId: '40000000-0000-4000-8000-000000000005',
      workoutId,
      setId: deletedSet.set.id,
      baseRevision: 1,
    },
  };
  const firstDelete = await app.inject({
    method: 'POST',
    url: '/api/v1/sync',
    headers: { cookie: athleteOneCookie },
    payload: deleteMutation,
  });
  assert.equal(firstDelete.statusCode, 200);
  assert.equal(firstDelete.json().entity, null);
  assert.equal(firstDelete.json().duplicate, false);
  const repeatedDelete = await app.inject({
    method: 'POST',
    url: '/api/v1/sync',
    headers: { cookie: athleteOneCookie },
    payload: deleteMutation,
  });
  assert.equal(repeatedDelete.statusCode, 200);
  assert.equal(repeatedDelete.json().duplicate, true);

  const athleteOneHistory = await app.inject({
    method: 'GET',
    url: '/api/v1/workouts',
    headers: { cookie: athleteOneCookie },
  });
  assert.equal(athleteOneHistory.json().items[0].revision, 3);
  assert.equal(athleteOneHistory.json().items[0].exercises[0].id, workout.exercises[1].id);
  assert.equal(athleteOneHistory.json().items[0].sets.length, 1);
  assert.equal(athleteOneHistory.json().items[0].sets[0].weightKg, 62.5);

  const athleteTwoHistory = await app.inject({
    method: 'GET',
    url: '/api/v1/workouts',
    headers: { cookie: athleteTwoCookie },
  });
  assert.deepEqual(athleteTwoHistory.json().items, []);

  const measurementId = '60000000-0000-4000-8000-000000000001';
  const invalidMeasurement = await app.inject({
    method: 'POST',
    url: '/api/v1/measurements',
    headers: { cookie: athleteOneCookie },
    payload: {
      id: '60000000-0000-4000-8000-000000000099',
      clientMutationId: '61000000-0000-4000-8000-000000000099',
      measuredOn: '2026-01-22T06:00:00.000Z',
      isSelfMeasured: true,
      values: {},
    },
  });
  assert.equal(invalidMeasurement.statusCode, 400);

  const createMeasurementMutation = {
    type: 'measurement.create',
    payload: {
      id: measurementId,
      clientMutationId: '61000000-0000-4000-8000-000000000001',
      measuredOn: '2026-01-22T06:00:00.000Z',
      isSelfMeasured: true,
      values: {
        weightKg: 82,
        waistCm: 91,
        bodyFat: { percent: 24.2, source: 'manual' },
      },
    },
  };
  const createdMeasurement = await app.inject({
    method: 'POST',
    url: '/api/v1/sync',
    headers: { cookie: athleteOneCookie },
    payload: createMeasurementMutation,
  });
  assert.equal(createdMeasurement.statusCode, 201);
  assert.equal(createdMeasurement.json().entity.revision, 1);
  assert.equal(createdMeasurement.json().entity.values.weightKg, 82);
  assert.deepEqual(createdMeasurement.json().entity.values.bodyFat, {
    percent: 24.2,
    source: 'manual',
  });
  const repeatedMeasurement = await app.inject({
    method: 'POST',
    url: '/api/v1/sync',
    headers: { cookie: athleteOneCookie },
    payload: createMeasurementMutation,
  });
  assert.equal(repeatedMeasurement.statusCode, 200);
  assert.equal(repeatedMeasurement.json().duplicate, true);

  const updatedMeasurement = await app.inject({
    method: 'POST',
    url: '/api/v1/sync',
    headers: { cookie: athleteOneCookie },
    payload: {
      type: 'measurement.update',
      payload: {
        clientMutationId: '61000000-0000-4000-8000-000000000002',
        measurementId,
        baseRevision: 1,
        changes: {
          measuredOn: '2026-01-22T06:00:00.000Z',
          isSelfMeasured: true,
          values: {
            weightKg: 80.5,
            waistCm: 88.5,
            bodyFat: {
              formula: 'rfm-2018',
              percent: 22.7,
              sex: 'male',
              source: 'calculated',
            },
          },
        },
      },
    },
  });
  assert.equal(updatedMeasurement.statusCode, 200);
  assert.equal(updatedMeasurement.json().entity.revision, 2);
  assert.equal(updatedMeasurement.json().entity.values.waistCm, 88.5);
  assert.deepEqual(updatedMeasurement.json().entity.values.bodyFat, {
    formula: 'rfm-2018',
    percent: 22.7,
    sex: 'male',
    source: 'calculated',
  });

  const crossUserMeasurement = await app.inject({
    method: 'POST',
    url: '/api/v1/sync',
    headers: { cookie: athleteTwoCookie },
    payload: {
      type: 'measurement.update',
      payload: {
        clientMutationId: '61000000-0000-4000-8000-000000000003',
        measurementId,
        baseRevision: 2,
        changes: { isSelfMeasured: false },
      },
    },
  });
  assert.equal(crossUserMeasurement.statusCode, 404);
  const athleteOneMeasurements = await app.inject({
    method: 'GET',
    url: '/api/v1/measurements',
    headers: { cookie: athleteOneCookie },
  });
  assert.equal(athleteOneMeasurements.statusCode, 200);
  assert.equal(athleteOneMeasurements.json().items.length, 1);
  const athleteTwoMeasurements = await app.inject({
    method: 'GET',
    url: '/api/v1/measurements',
    headers: { cookie: athleteTwoCookie },
  });
  assert.deepEqual(athleteTwoMeasurements.json().items, []);

  const athleteCannotInvite = await app.inject({
    method: 'POST',
    url: '/api/v1/trainer/invites',
    headers: { cookie: athleteOneCookie },
    payload: {},
  });
  assert.equal(athleteCannotInvite.statusCode, 403);

  const createdInvite = await app.inject({
    method: 'POST',
    url: '/api/v1/trainer/invites',
    headers: { cookie: trainerCookie },
    payload: { email: 'ONE@example.com' },
  });
  assert.equal(createdInvite.statusCode, 201);
  assert.equal(createdInvite.json().invite.email, 'one@example.com');
  assert.ok(createdInvite.json().token);
  const trainerInvites = await app.inject({
    method: 'GET',
    url: '/api/v1/trainer/invites',
    headers: { cookie: trainerCookie },
  });
  assert.equal(trainerInvites.statusCode, 200);
  assert.equal(trainerInvites.json().items[0].status, 'pending');
  assert.equal('token' in trainerInvites.json().items[0], false);

  const wrongInviteAccount = await app.inject({
    method: 'POST',
    url: '/api/v1/trainer/invites/accept',
    headers: { cookie: athleteTwoCookie },
    payload: { token: createdInvite.json().token },
  });
  assert.equal(wrongInviteAccount.statusCode, 403);
  const acceptedInvite = await app.inject({
    method: 'POST',
    url: '/api/v1/trainer/invites/accept',
    headers: { cookie: athleteOneCookie },
    payload: { token: createdInvite.json().token },
  });
  assert.equal(acceptedInvite.statusCode, 200);
  assert.equal(acceptedInvite.json().trainer.displayName, 'Coach');
  const repeatedInvite = await app.inject({
    method: 'POST',
    url: '/api/v1/trainer/invites/accept',
    headers: { cookie: athleteOneCookie },
    payload: { token: createdInvite.json().token },
  });
  assert.equal(repeatedInvite.statusCode, 409);

  const trainerRoster = await app.inject({
    method: 'GET',
    url: '/api/v1/trainer/athletes',
    headers: { cookie: trainerCookie },
  });
  assert.equal(trainerRoster.statusCode, 200);
  assert.equal(trainerRoster.json().items[0].displayName, 'Athlete One');
  const sharedWorkouts = await app.inject({
    method: 'GET',
    url: `/api/v1/trainer/athletes/${athleteOneProfile.json().user.id}/workouts`,
    headers: { cookie: trainerCookie },
  });
  assert.equal(sharedWorkouts.statusCode, 200);
  assert.equal(sharedWorkouts.json().items[0].id, workoutId);
  const sharedMeasurements = await app.inject({
    method: 'GET',
    url: `/api/v1/trainer/athletes/${athleteOneProfile.json().user.id}/measurements`,
    headers: { cookie: trainerCookie },
  });
  assert.equal(sharedMeasurements.statusCode, 200);
  assert.equal(sharedMeasurements.json().items.length, 1);
  const trainerCannotMutateAthleteSet = await app.inject({
    method: 'PATCH',
    url: `/api/v1/sets/${set.set.id}`,
    headers: { cookie: trainerCookie },
    payload: {
      clientMutationId: '40000000-0000-4000-8000-000000000098',
      workoutId,
      baseRevision: 2,
      changes: { weightKg: 999 },
    },
  });
  assert.equal(trainerCannotMutateAthleteSet.statusCode, 404);

  const relationship = await app.inject({
    method: 'GET',
    url: '/api/v1/trainer/relationship',
    headers: { cookie: athleteOneCookie },
  });
  assert.equal(relationship.json().trainer.displayName, 'Coach');
  const revokedRelationship = await app.inject({
    method: 'DELETE',
    url: '/api/v1/trainer/relationship',
    headers: { cookie: athleteOneCookie },
  });
  assert.equal(revokedRelationship.statusCode, 204);
  const revokedSharedAccess = await app.inject({
    method: 'GET',
    url: `/api/v1/trainer/athletes/${athleteOneProfile.json().user.id}/workouts`,
    headers: { cookie: trainerCookie },
  });
  assert.equal(revokedSharedAccess.statusCode, 404);

  const cancellableInvite = await app.inject({
    method: 'POST',
    url: '/api/v1/trainer/invites',
    headers: { cookie: trainerCookie },
    payload: {},
  });
  const cancelledInvite = await app.inject({
    method: 'DELETE',
    url: `/api/v1/trainer/invites/${cancellableInvite.json().invite.id}`,
    headers: { cookie: trainerCookie },
  });
  assert.equal(cancelledInvite.statusCode, 204);

  const removedMeasurementId = '60000000-0000-4000-8000-000000000002';
  await app.inject({
    method: 'POST',
    url: '/api/v1/sync',
    headers: { cookie: athleteOneCookie },
    payload: {
      type: 'measurement.create',
      payload: {
        ...createMeasurementMutation.payload,
        id: removedMeasurementId,
        clientMutationId: '61000000-0000-4000-8000-000000000004',
        measuredOn: '2025-03-23T06:00:00.000Z',
      },
    },
  });
  const deleteMeasurementMutation = {
    type: 'measurement.delete',
    payload: {
      clientMutationId: '61000000-0000-4000-8000-000000000005',
      measurementId: removedMeasurementId,
      baseRevision: 1,
    },
  };
  const deletedMeasurement = await app.inject({
    method: 'POST',
    url: '/api/v1/sync',
    headers: { cookie: athleteOneCookie },
    payload: deleteMeasurementMutation,
  });
  assert.equal(deletedMeasurement.statusCode, 200);
  assert.equal(deletedMeasurement.json().duplicate, false);
  const repeatedMeasurementDelete = await app.inject({
    method: 'POST',
    url: '/api/v1/sync',
    headers: { cookie: athleteOneCookie },
    payload: deleteMeasurementMutation,
  });
  assert.equal(repeatedMeasurementDelete.statusCode, 200);
  assert.equal(repeatedMeasurementDelete.json().duplicate, true);

  const crossUserSet = await app.inject({
    method: 'POST',
    url: '/api/v1/sets',
    headers: { cookie: athleteTwoCookie },
    payload: { ...set, clientMutationId: '40000000-0000-4000-8000-000000000002' },
  });
  assert.equal(crossUserSet.statusCode, 404);

  const athleteAdminRequest = await app.inject({
    method: 'GET',
    url: '/api/v1/admin/users',
    headers: { cookie: athleteOneCookie },
  });
  assert.equal(athleteAdminRequest.statusCode, 403);
  const adminUsers = await app.inject({
    method: 'GET',
    url: '/api/v1/admin/users',
    headers: { cookie: adminCookie },
  });
  assert.equal(adminUsers.statusCode, 200);
  assert.equal(adminUsers.json().items.length, 4);

  const deleteWorkoutMutation = {
    type: 'workout.delete',
    payload: {
      clientMutationId: '30000000-0000-4000-8000-000000000004',
      workoutId,
      baseRevision: 3,
    },
  };
  const deletedWorkout = await app.inject({
    method: 'POST',
    url: '/api/v1/sync',
    headers: { cookie: athleteOneCookie },
    payload: deleteWorkoutMutation,
  });
  assert.equal(deletedWorkout.statusCode, 200);
  assert.equal(deletedWorkout.json().entity, null);
  assert.equal(deletedWorkout.json().duplicate, false);
  const repeatedWorkoutDelete = await app.inject({
    method: 'POST',
    url: '/api/v1/sync',
    headers: { cookie: athleteOneCookie },
    payload: deleteWorkoutMutation,
  });
  assert.equal(repeatedWorkoutDelete.statusCode, 200);
  assert.equal(repeatedWorkoutDelete.json().duplicate, true);
  const historyAfterWorkoutDelete = await app.inject({
    method: 'GET',
    url: '/api/v1/workouts',
    headers: { cookie: athleteOneCookie },
  });
  assert.deepEqual(historyAfterWorkoutDelete.json().items, []);

  const logout = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/logout',
    headers: { cookie: athleteOneCookie },
  });
  assert.equal(logout.statusCode, 204);
  const loggedOutProfile = await app.inject({
    method: 'GET',
    url: '/api/v1/me',
    headers: { cookie: athleteOneCookie },
  });
  assert.equal(loggedOutProfile.statusCode, 401);

  await app.close();
});

test('OAuth state is bound to its cookie and can only be consumed once', async () => {
  const repository = new MemoryRepository();
  const provider = new FakeIdentityProvider();
  provider.identities.set('athlete', {
    subject: 'google-athlete',
    email: 'athlete@example.com',
    displayName: 'Athlete',
    avatarUrl: null,
  });
  const auth: AuthOptions = {
    provider,
    adminEmails: new Set(),
    trainerEmails: new Set(),
    secureCookies: false,
    sessionTtlMs: 30 * 24 * 60 * 60 * 1_000,
  };
  const app = buildApp(repository, { auth });
  await app.ready();

  const start = await app.inject({
    method: 'GET',
    url: '/api/v1/auth/google?returnTo=//evil.test',
  });
  const location = new URL(start.headers.location ?? '');
  const state = location.searchParams.get('state');
  assert.ok(state);
  const stateCookie = cookieValue(start.headers['set-cookie'], 'mc_oauth_state');

  const wrongState = await app.inject({
    method: 'GET',
    url: '/api/v1/auth/google/callback?code=athlete&state=wrong',
    headers: { cookie: stateCookie },
  });
  assert.equal(wrongState.statusCode, 400);

  const callbackUrl = `/api/v1/auth/google/callback?code=athlete&state=${encodeURIComponent(state)}`;
  const callback = await app.inject({
    method: 'GET',
    url: callbackUrl,
    headers: { cookie: stateCookie },
  });
  assert.equal(callback.statusCode, 302);
  assert.equal(callback.headers.location, '/');

  const replay = await app.inject({
    method: 'GET',
    url: callbackUrl,
    headers: { cookie: stateCookie },
  });
  assert.equal(replay.statusCode, 400);

  await app.close();
});

async function logIn(app: ReturnType<typeof buildApp>, code: string) {
  const start = await app.inject({ method: 'GET', url: '/api/v1/auth/google?returnTo=/' });
  assert.equal(start.statusCode, 302);
  const location = new URL(start.headers.location ?? '');
  const state = location.searchParams.get('state');
  assert.ok(state);
  assert.equal(location.searchParams.get('code_challenge_method'), 'S256');

  const stateCookie = cookieValue(start.headers['set-cookie'], 'mc_oauth_state');
  const callback = await app.inject({
    method: 'GET',
    url: `/api/v1/auth/google/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`,
    headers: { cookie: stateCookie },
  });
  assert.equal(callback.statusCode, 302);
  assert.equal(callback.headers.location, '/');
  return cookieValue(callback.headers['set-cookie'], 'mc_session');
}

function cookieValue(header: string | string[] | undefined, name: string) {
  const cookies = Array.isArray(header) ? header : header ? [header] : [];
  const cookie = cookies.find((value) => value.startsWith(`${name}=`));
  assert.ok(cookie, `Expected ${name} cookie`);
  return cookie.split(';', 1)[0];
}
