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

import { db } from './db';
import { flushOutbox, queueMutation } from './sync';

export async function discoverExercises(
  query: string,
  locale: CurrentUser['locale'],
): Promise<ExerciseDiscoveryResult> {
  const response = await fetch('/api/v1/exercises/discover', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, locale }),
  });
  handleUnauthorized(response);
  if (response.status === 503) throw new Error('discovery_not_configured');
  if (!response.ok) throw new Error('discovery_unavailable');
  return exerciseDiscoveryResultSchema.parse(await response.json());
}

export async function startExerciseDiscovery(
  query: string,
  locale: CurrentUser['locale'],
  exerciseId?: string,
): Promise<ExerciseDiscoveryJob> {
  const response = await fetch('/api/v1/exercise-discoveries', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, locale, exerciseId }),
  });
  handleUnauthorized(response);
  if (response.status === 503) throw new Error('discovery_not_configured');
  if (!response.ok) throw new Error('discovery_unavailable');
  const payload = (await response.json()) as { job?: unknown };
  return exerciseDiscoveryJobSchema.parse(payload.job);
}

export async function getExerciseDiscovery(jobId: string): Promise<ExerciseDiscoveryJob> {
  const response = await fetch(`/api/v1/exercise-discoveries/${jobId}`, {
    credentials: 'same-origin',
  });
  handleUnauthorized(response);
  if (!response.ok) throw new Error('discovery_unavailable');
  const payload = (await response.json()) as { job?: unknown };
  return exerciseDiscoveryJobSchema.parse(payload.job);
}

export async function cancelExerciseDiscovery(jobId: string) {
  const response = await fetch(`/api/v1/exercise-discoveries/${jobId}`, {
    method: 'DELETE',
    credentials: 'same-origin',
  });
  handleUnauthorized(response);
  if (!response.ok && response.status !== 404) throw new Error('discovery_unavailable');
}

export async function createManualExercise({
  name,
  locale,
  primaryMuscle,
}: {
  name: string;
  locale: CurrentUser['locale'];
  primaryMuscle: Exercise['primaryMuscles'][number];
}): Promise<Exercise> {
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
    await queueMutation({
      type: 'exercise.create',
      payload: { clientMutationId, ...exerciseDetails(exercise) },
    });
  });
  void flushOutbox();
  return exercise;
}

export async function cacheExercise(exercise: Exercise) {
  const local = await db.exercises.get(exercise.id);
  await db.exercises.put({
    ...exercise,
    ...(local?.syncState ? { syncState: local.syncState } : {}),
  });
}

export async function createPersonalExercise(
  candidate: ExerciseDiscoveryCandidate,
): Promise<Exercise> {
  const { confidence: _confidence, matchReason: _matchReason, ...details } = candidate;
  const response = await fetch('/api/v1/exercises', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: crypto.randomUUID(), ...details }),
  });
  handleUnauthorized(response);
  if (!response.ok) throw new Error('exercise_save_failed');
  const payload = (await response.json()) as { exercise?: unknown };
  return exerciseSchema.parse(payload.exercise);
}

export async function updatePersonalExercise(
  exerciseId: string,
  changes: UpdateExerciseInput,
): Promise<Exercise> {
  return writePersonalExercise(`/api/v1/exercises/${exerciseId}`, 'PUT', changes);
}

export async function softDeletePersonalExercise(exerciseId: string): Promise<Exercise> {
  return writePersonalExercise(`/api/v1/exercises/${exerciseId}`, 'DELETE');
}

async function writePersonalExercise(
  url: string,
  method: 'PUT' | 'DELETE',
  body?: UpdateExerciseInput,
) {
  const response = await fetch(url, {
    method,
    credentials: 'same-origin',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  handleUnauthorized(response);
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
