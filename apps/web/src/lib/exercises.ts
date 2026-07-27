import {
  exerciseDiscoveryResultSchema,
  exerciseSchema,
  type CurrentUser,
  type Exercise,
  type ExerciseDiscoveryCandidate,
  type ExerciseDiscoveryResult,
  type UpdateExerciseInput,
} from '@mighty-cringe/contracts';

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
