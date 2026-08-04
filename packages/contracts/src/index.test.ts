import assert from 'node:assert/strict';
import test from 'node:test';

import {
  exercisePreferenceRecordSchema,
  setExercisePreferenceSchema,
  syncMutationSchema,
} from './index.js';

const exerciseId = '10000000-0000-4000-8000-000000000001';
const clientMutationId = '91000000-0000-4000-8000-000000000001';

test('exercise preference contracts support like, dislike, and a revisioned null value', () => {
  assert.deepEqual(
    exercisePreferenceRecordSchema.parse({
      exerciseId,
      value: null,
      revision: 3,
      updatedAt: '2026-08-05T08:00:00.000Z',
    }),
    {
      exerciseId,
      value: null,
      revision: 3,
      updatedAt: '2026-08-05T08:00:00.000Z',
    },
  );

  for (const value of ['like', 'dislike', null] as const) {
    assert.equal(
      syncMutationSchema.safeParse({
        type: 'exercise-preference.set',
        payload: { clientMutationId, exerciseId, value, baseRevision: 0 },
      }).success,
      true,
    );
  }
});

test('exercise preference contracts reject unknown values and invalid revisions', () => {
  assert.equal(
    setExercisePreferenceSchema.safeParse({
      clientMutationId,
      exerciseId,
      value: 'maybe',
      baseRevision: 0,
    }).success,
    false,
  );
  assert.equal(
    exercisePreferenceRecordSchema.safeParse({
      exerciseId,
      value: 'like',
      revision: 0,
      updatedAt: '2026-08-05T08:00:00.000Z',
    }).success,
    false,
  );
});
