import {
  exerciseDiscoveryResultSchema,
  exerciseDiscoveryJobSchema,
  exerciseSchema,
  type CurrentUser,
  type Exercise,
  type ExerciseDiscoveryCandidate,
  type ExerciseDiscoveryResult,
  type ExerciseDiscoveryJob,
  type UpdateExerciseInput,
} from '@mighty-cringe/contracts';

import { assertDataContext, getDataContext, sportingRequest } from './dataContext';
import { flushOutbox, queueMutation } from './sync';

export async function discoverExercises(
  query: string,
  locale: CurrentUser['locale'],
  context = getDataContext(),
): Promise<ExerciseDiscoveryResult> {
  const response = await sportingRequest(
    '/api/v1/exercises/discover',
    {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, locale }),
    },
    context,
  );
  handleUnauthorized(response);
  if (response.status === 503) throw new Error('discovery_not_configured');
  if (!response.ok) throw new Error('discovery_unavailable');
  return exerciseDiscoveryResultSchema.parse(await response.json());
}

export async function startExerciseDiscovery(
  query: string,
  locale: CurrentUser['locale'],
  exerciseId?: string,
  context = getDataContext(),
): Promise<ExerciseDiscoveryJob> {
  const response = await sportingRequest(
    '/api/v1/exercise-discoveries',
    {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, locale, exerciseId }),
    },
    context,
  );
  handleUnauthorized(response);
  if (response.status === 503) throw new Error('discovery_not_configured');
  if (!response.ok) throw new Error('discovery_unavailable');
  const payload = (await response.json()) as { job?: unknown };
  return exerciseDiscoveryJobSchema.parse(payload.job);
}

export async function getExerciseDiscovery(
  jobId: string,
  context = getDataContext(),
): Promise<ExerciseDiscoveryJob> {
  const response = await sportingRequest(
    `/api/v1/exercise-discoveries/${jobId}`,
    {
      credentials: 'same-origin',
    },
    context,
  );
  handleUnauthorized(response);
  if (!response.ok) throw new Error('discovery_unavailable');
  const payload = (await response.json()) as { job?: unknown };
  return exerciseDiscoveryJobSchema.parse(payload.job);
}

export async function cancelExerciseDiscovery(jobId: string, context = getDataContext()) {
  const response = await sportingRequest(
    `/api/v1/exercise-discoveries/${jobId}`,
    {
      method: 'DELETE',
      credentials: 'same-origin',
    },
    context,
  );
  handleUnauthorized(response);
  if (!response.ok && response.status !== 404) throw new Error('discovery_unavailable');
}

export async function createManualExercise(
  {
    name,
    locale,
    primaryMuscle,
  }: {
    name: string;
    locale: CurrentUser['locale'];
    primaryMuscle: Exercise['primaryMuscles'][number];
  },
  context = getDataContext(),
): Promise<Exercise> {
  const db = context.database;
  const normalizedName = name.trim();
  const exercise: Exercise = {
    id: crypto.randomUUID(),
    scope: 'user',
    deletedAt: null,
    nameRu: normalizedName,
    nameEn: normalizedName,
    aliases: [],
    tag: 'normal',
    primaryMuscles: [primaryMuscle],
    secondaryMuscles: [],
    equipment: [],
    videos: [],
    sources: [],
    notes: null,
  };
  const clientMutationId = crypto.randomUUID();
  await db.transaction('rw', db.exercises, db.outbox, async () => {
    await db.exercises.put({ ...exercise, syncState: 'pending' });
    await queueMutation(
      {
        type: 'exercise.create',
        payload: { clientMutationId, ...exerciseDetails(exercise) },
      },
      context,
    );
  });
  void flushOutbox(context);
  return exercise;
}

export async function cacheExercise(exercise: Exercise, context = getDataContext()) {
  assertDataContext(context);
  const db = context.database;
  await db.transaction('rw', db.exercises, async () => {
    const local = await db.exercises.get(exercise.id);
    assertDataContext(context);
    if ((local?.revision ?? 0) > (exercise.revision ?? 0)) return;
    await db.exercises.put({
      ...exercise,
      ...(local?.syncState ? { syncState: local.syncState } : {}),
    });
  });
}

export async function createPersonalExercise(
  candidate: ExerciseDiscoveryCandidate,
  context = getDataContext(),
): Promise<Exercise> {
  const { confidence: _confidence, matchReason: _matchReason, ...details } = candidate;
  const response = await sportingRequest(
    '/api/v1/exercises',
    {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: crypto.randomUUID(), ...details }),
    },
    context,
  );
  handleUnauthorized(response);
  if (!response.ok) throw new Error('exercise_save_failed');
  const payload = (await response.json()) as { exercise?: unknown };
  return exerciseSchema.parse(payload.exercise);
}

export async function updatePersonalExercise(
  exerciseId: string,
  changes: UpdateExerciseInput,
  context = getDataContext(),
  expectedRevision?: number,
): Promise<Exercise> {
  return writePersonalExercise(exerciseId, 'PUT', changes, context, expectedRevision);
}

export async function softDeletePersonalExercise(
  exerciseId: string,
  context = getDataContext(),
  expectedRevision?: number,
): Promise<Exercise> {
  return writePersonalExercise(exerciseId, 'DELETE', undefined, context, expectedRevision);
}

async function writePersonalExercise(
  exerciseId: string,
  method: 'PUT' | 'DELETE',
  body?: UpdateExerciseInput,
  context = getDataContext(),
  expectedRevision?: number,
) {
  const exercise = await context.database.exercises.get(exerciseId);
  const revision = expectedRevision ?? exercise?.revision;
  if (context.relationshipId && !revision) throw new Error('exercise_revision_required');
  const headers = new Headers(body ? { 'Content-Type': 'application/json' } : undefined);
  if (revision) headers.set('If-Match', String(revision));
  const response = await sportingRequest(
    `/api/v1/exercises/${exerciseId}`,
    {
      method,
      credentials: 'same-origin',
      headers,
      body: body ? JSON.stringify(body) : undefined,
    },
    context,
  );
  handleUnauthorized(response);
  if (response.status === 409) throw new Error('exercise_revision_conflict');
  if (response.status === 428) throw new Error('exercise_revision_required');
  if (response.status === 404) throw new Error('personal_exercise_not_found');
  if (!response.ok) throw new Error('exercise_save_failed');
  const payload = (await response.json()) as { exercise?: unknown };
  return exerciseSchema.parse(payload.exercise);
}

function handleUnauthorized(response: Response) {
  if (response.status === 401) {
    window.dispatchEvent(new Event('mighty-cringe:unauthorized'));
    throw new Error('authentication_required');
  }
}

function exerciseDetails(exercise: Exercise) {
  return {
    id: exercise.id,
    nameRu: exercise.nameRu,
    nameEn: exercise.nameEn,
    aliases: exercise.aliases,
    tag: exercise.tag,
    primaryMuscles: exercise.primaryMuscles,
    secondaryMuscles: exercise.secondaryMuscles,
    equipment: exercise.equipment,
    videos: exercise.videos ?? [],
    sources: exercise.sources ?? [],
    notes: exercise.notes ?? null,
  };
}
