import type {
  DeleteMeasurementInput,
  DeleteSetInput,
  DeleteWorkoutInput,
  Exercise,
  ExercisePreferenceRecord,
  MeasurementRecord,
  SetRecord,
  SetExercisePreferenceInput,
  SyncMutation,
  UpdateMeasurementInput,
  UpdateSetInput,
  UpdateWorkoutInput,
  WorkoutRecord,
} from '@mighty-cringe/contracts';

import { type LocalWorkout, type OutboxMutation, type SyncConflict } from './db';
import {
  assertDataContext,
  getDataContext,
  isDataContextValid,
  sportingRequest,
  subscribeDataContext,
  type DataContext,
} from './dataContext';
import { flushVoiceQueue, refreshVoiceEntries } from './voice';

type MutationResponse =
  | { entityType: 'exercise'; entity: Exercise; duplicate: boolean }
  | {
      entityType: 'exercisePreference';
      entity: ExercisePreferenceRecord;
      duplicate: boolean;
    }
  | { entityType: 'workout'; entity: WorkoutRecord; duplicate: boolean }
  | { entityType: 'workout'; entity: null; entityId: string; duplicate: boolean }
  | { entityType: 'set'; entity: SetRecord; duplicate: boolean }
  | { entityType: 'set'; entity: null; entityId: string; duplicate: boolean }
  | { entityType: 'measurement'; entity: MeasurementRecord; duplicate: boolean }
  | { entityType: 'measurement'; entity: null; entityId: string; duplicate: boolean };

export type SyncStatus = {
  phase: 'idle' | 'syncing' | 'offline' | 'error';
  message: string | null;
};

type SyncOutcome = 'success' | 'offline' | 'retry' | 'unauthorized' | 'forbidden';

let lastSequence = 0;
type ContextSyncState = {
  activeFlush: Promise<SyncOutcome> | null;
  activeSync: Promise<SyncOutcome> | null;
  activeRefresh: Promise<SyncOutcome> | null;
  retryAttempt: number;
  retryTimer: ReturnType<typeof setTimeout> | null;
  status: SyncStatus;
};
const contextStates = new WeakMap<DataContext, ContextSyncState>();
const syncListeners = new Set<() => void>();
subscribeDataContext(() => {
  for (const listener of syncListeners) listener();
});

function stateFor(context: DataContext) {
  let state = contextStates.get(context);
  if (!state) {
    state = {
      activeFlush: null,
      activeSync: null,
      activeRefresh: null,
      retryAttempt: 0,
      retryTimer: null,
      status: { phase: browserOnline() ? 'idle' : 'offline', message: null },
    };
    contextStates.set(context, state);
  }
  return state;
}

export function getSyncStatus(context = getDataContext()) {
  return stateFor(context).status;
}

export function subscribeSyncStatus(listener: () => void, _context = getDataContext()) {
  syncListeners.add(listener);
  return () => syncListeners.delete(listener);
}

export async function queueMutation(mutation: SyncMutation, context = getDataContext()) {
  if (!isDataContextValid(context)) throw new Error('data_context_unavailable');
  const db = context.database;
  const id = mutation.payload.clientMutationId;
  await db.outbox.put({
    id,
    sequence: nextSequence(),
    createdAt: new Date().toISOString(),
    mutation,
  });
  if (browserOnline()) setTimeout(() => void flushOutbox(context), 0);
}

export function flushOutbox(context = getDataContext()): Promise<SyncOutcome> {
  const state = stateFor(context);
  if (state.activeFlush) return state.activeFlush;
  if (state.activeRefresh) return state.activeRefresh.then(() => flushOutbox(context));
  if (!isDataContextValid(context)) return Promise.resolve('forbidden' as const);
  updateSyncStatus(
    browserOnline() ? { phase: 'syncing', message: null } : { phase: 'offline', message: null },
    context,
  );
  state.activeFlush = performFlush(context)
    .catch(() => (isDataContextValid(context) ? ('retry' as const) : ('forbidden' as const)))
    .then(async (outcome) => {
      await finishSync(outcome, context);
      return outcome;
    })
    .finally(() => {
      state.activeFlush = null;
    });
  return state.activeFlush;
}

export function syncAll(context = getDataContext()): Promise<SyncOutcome> {
  const state = stateFor(context);
  if (state.activeSync) return state.activeSync;
  state.activeSync = performSyncAll(context).finally(() => {
    state.activeSync = null;
  });
  return state.activeSync;
}

async function performSyncAll(context: DataContext) {
  const flushOutcome = await flushOutbox(context);
  if (flushOutcome !== 'success') return flushOutcome;
  if (!context.relationshipId) {
    const voiceOutcome = await flushVoiceQueue(context);
    if (voiceOutcome !== 'success') {
      await finishSync(voiceOutcome, context);
      return voiceOutcome;
    }
  }
  if (!isDataContextValid(context)) return 'forbidden' as const;
  updateSyncStatus({ phase: 'syncing', message: null }, context);
  const refreshOutcome = await refreshHistory(context).catch(() =>
    isDataContextValid(context) ? ('retry' as const) : ('forbidden' as const),
  );
  await finishSync(refreshOutcome, context);
  return refreshOutcome;
}

export function refreshHistory(context = getDataContext()): Promise<SyncOutcome> {
  const state = stateFor(context);
  if (state.activeRefresh) return state.activeRefresh;
  const flush = state.activeFlush;
  state.activeRefresh = (async () => {
    if (flush) {
      const outcome = await flush;
      if (outcome !== 'success') return outcome;
    }
    return performRefreshHistory(context);
  })().finally(() => {
    state.activeRefresh = null;
  });
  return state.activeRefresh;
}

async function performRefreshHistory(context: DataContext): Promise<SyncOutcome> {
  if (!browserOnline()) return 'offline';

  const outcomes = await Promise.all([
    refreshWorkoutHistory(context),
    refreshMeasurementHistory(context),
    refreshExercisePreferences(context),
    refreshExercises(context),
    ...(context.relationshipId ? [] : [refreshVoiceEntries(context)]),
  ]);
  return combineOutcomes(outcomes);
}

async function refreshWorkoutHistory(context: DataContext): Promise<SyncOutcome> {
  const db = context.database;
  let response: Response;
  try {
    response = await sportingRequest('/api/v1/workouts', { credentials: 'same-origin' }, context);
  } catch {
    return isDataContextValid(context) ? 'retry' : 'forbidden';
  }
  if (response.status === 401) {
    window.dispatchEvent(new Event('mighty-cringe:unauthorized'));
    return 'unauthorized';
  }
  if (response.status === 403) return 'forbidden';
  if (!response.ok) return 'retry';

  const payload = (await response.json()) as { items: WorkoutRecord[] };
  if (!isDataContextValid(context)) return 'forbidden';
  await db.transaction('rw', db.workouts, db.sets, async () => {
    const serverWorkoutIds = new Set(payload.items.map((workout) => workout.id));
    const serverSetIds = new Set(
      payload.items.flatMap((workout) => workout.sets.map((set) => set.id)),
    );

    for (const workout of payload.items) {
      const local = await db.workouts.get(workout.id);
      if (!local || local.syncState === 'synced') {
        await db.workouts.put({ ...withoutSets(workout), syncState: 'synced' });
      }
      for (const set of workout.sets) {
        const localSet = await db.sets.get(set.id);
        if (!localSet || localSet.syncState === 'synced') {
          await db.sets.put({ ...set, deleted: false, syncState: 'synced' });
        }
      }
    }

    const localSets = await db.sets.toArray();
    await Promise.all(
      localSets
        .filter((set) => set.syncState === 'synced' && !serverSetIds.has(set.id))
        .map((set) => db.sets.delete(set.id)),
    );
    const localWorkouts = await db.workouts.toArray();
    await Promise.all(
      localWorkouts
        .filter((workout) => workout.syncState === 'synced' && !serverWorkoutIds.has(workout.id))
        .map((workout) => db.workouts.delete(workout.id)),
    );
  });
  return 'success';
}

async function refreshMeasurementHistory(context: DataContext): Promise<SyncOutcome> {
  const db = context.database;
  let response: Response;
  try {
    response = await sportingRequest(
      '/api/v1/measurements',
      { credentials: 'same-origin' },
      context,
    );
  } catch {
    return isDataContextValid(context) ? 'retry' : 'forbidden';
  }
  if (response.status === 401) {
    window.dispatchEvent(new Event('mighty-cringe:unauthorized'));
    return 'unauthorized';
  }
  if (response.status === 403) return 'forbidden';
  if (!response.ok) return 'retry';

  const payload = (await response.json()) as { items: MeasurementRecord[] };
  if (!isDataContextValid(context)) return 'forbidden';
  await db.transaction('rw', db.measurements, async () => {
    const serverIds = new Set(payload.items.map((measurement) => measurement.id));
    for (const measurement of payload.items) {
      const local = await db.measurements.get(measurement.id);
      if (!local || local.syncState === 'synced') {
        await db.measurements.put({ ...measurement, deleted: false, syncState: 'synced' });
      }
    }
    const localMeasurements = await db.measurements.toArray();
    await Promise.all(
      localMeasurements
        .filter(
          (measurement) => measurement.syncState === 'synced' && !serverIds.has(measurement.id),
        )
        .map((measurement) => db.measurements.delete(measurement.id)),
    );
  });
  return 'success';
}

export async function refreshExercisePreferences(context = getDataContext()): Promise<SyncOutcome> {
  const db = context.database;
  let response: Response;
  try {
    response = await sportingRequest(
      '/api/v1/exercise-preferences',
      { credentials: 'same-origin' },
      context,
    );
  } catch {
    return isDataContextValid(context) ? 'retry' : 'forbidden';
  }
  if (response.status === 401) {
    window.dispatchEvent(new Event('mighty-cringe:unauthorized'));
    return 'unauthorized';
  }
  if (response.status === 403) return 'forbidden';
  if (!response.ok) return 'retry';

  const payload = (await response.json()) as { items: ExercisePreferenceRecord[] };
  if (!isDataContextValid(context)) return 'forbidden';
  await db.transaction('rw', db.exercisePreferences, async () => {
    const serverIds = new Set(payload.items.map((preference) => preference.exerciseId));
    for (const preference of payload.items) {
      const local = await db.exercisePreferences.get(preference.exerciseId);
      if (!local || local.syncState === 'synced') {
        await db.exercisePreferences.put({ ...preference, syncState: 'synced' });
      }
    }
    const localPreferences = await db.exercisePreferences.toArray();
    await Promise.all(
      localPreferences
        .filter(
          (preference) =>
            preference.syncState === 'synced' && !serverIds.has(preference.exerciseId),
        )
        .map((preference) => db.exercisePreferences.delete(preference.exerciseId)),
    );
  });
  return 'success';
}

export async function refreshExercises(context = getDataContext()): Promise<SyncOutcome> {
  const db = context.database;
  let response: Response;
  try {
    response = await sportingRequest('/api/v1/exercises', { credentials: 'same-origin' }, context);
  } catch {
    return isDataContextValid(context) ? 'retry' : 'forbidden';
  }
  if (response.status === 401) {
    window.dispatchEvent(new Event('mighty-cringe:unauthorized'));
    return 'unauthorized';
  }
  if (response.status === 403) return 'forbidden';
  if (!response.ok) return 'retry';
  const payload = (await response.json()) as { items: Exercise[] };
  if (!isDataContextValid(context)) return 'forbidden';
  await db.transaction('rw', db.exercises, db.outbox, async () => {
    const pendingIds = new Set(
      (await db.outbox.toArray())
        .filter((item) => item.mutation.type === 'exercise.create')
        .map((item) => (item.mutation.type === 'exercise.create' ? item.mutation.payload.id : '')),
    );
    const local = await db.exercises.toArray();
    const remote = new Map(payload.items.map((exercise) => [exercise.id, exercise]));
    const preserved = local.filter(
      (exercise) =>
        pendingIds.has(exercise.id) ||
        (exercise.revision ?? 0) > (remote.get(exercise.id)?.revision ?? 0),
    );
    await db.exercises.clear();
    await db.exercises.bulkPut(payload.items);
    await db.exercises.bulkPut(preserved);
  });
  return 'success';
}

export async function resolveConflict(
  conflictId: string,
  strategy: 'server' | 'mine',
  context = getDataContext(),
) {
  const db = context.database;
  assertDataContext(context);
  const conflict = await db.conflicts.get(conflictId);
  assertDataContext(context);
  if (!conflict) return;

  if (strategy === 'server') {
    await db.transaction(
      'rw',
      db.workouts,
      db.sets,
      db.measurements,
      db.exercisePreferences,
      db.conflicts,
      async () => {
        if (conflict.current) {
          await applyCurrent(conflict.current, context);
        } else if (conflict.entityType === 'workout') {
          await db.sets.where('workoutId').equals(conflict.entityId).delete();
          await db.workouts.delete(conflict.entityId);
        } else if (conflict.entityType === 'set') {
          await db.sets.delete(conflict.entityId);
        } else if (conflict.entityType === 'measurement') {
          await db.measurements.delete(conflict.entityId);
        } else {
          await db.exercisePreferences.delete(conflict.entityId);
        }
        await db.conflicts.delete(conflict.id);
      },
    );
    return;
  }

  const rebased = await rebaseMutation(conflict, context);
  assertDataContext(context);
  if (!rebased) return;
  await db.transaction(
    'rw',
    [db.workouts, db.sets, db.measurements, db.exercisePreferences, db.outbox, db.conflicts],
    async () => {
      if (conflict.current) {
        if (isWorkoutRecord(conflict.current)) {
          await db.workouts.update(conflict.entityId, {
            revision: conflict.current.revision,
            updatedAt: conflict.current.updatedAt,
          });
        } else if (isSetRecord(conflict.current)) {
          await db.sets.update(conflict.entityId, {
            revision: conflict.current.revision,
            updatedAt: conflict.current.updatedAt,
          });
        } else if (isMeasurementRecord(conflict.current)) {
          await db.measurements.update(conflict.entityId, {
            revision: conflict.current.revision,
            updatedAt: conflict.current.updatedAt,
          });
        } else {
          await db.exercisePreferences.update(conflict.entityId, {
            revision: conflict.current.revision,
            updatedAt: conflict.current.updatedAt,
          });
        }
      }
      await markSyncState(rebased, 'pending', context);
      await db.outbox.put({
        id: rebased.payload.clientMutationId,
        sequence: nextSequence(),
        createdAt: new Date().toISOString(),
        mutation: rebased,
      });
      await db.conflicts.delete(conflict.id);
    },
  );
  await flushOutbox(context);
}

async function performFlush(context: DataContext): Promise<SyncOutcome> {
  const db = context.database;
  if (!browserOnline()) return 'offline';

  while (browserOnline()) {
    if (!isDataContextValid(context)) return 'forbidden';
    const queued = await db.outbox.orderBy('sequence').first();
    if (!queued) return 'success';
    const prepared = await prepareMutation(queued, context);
    if (!prepared) return 'retry';

    let response: Response;
    try {
      response = await sportingRequest(
        '/api/v1/sync',
        {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(prepared.mutation),
        },
        context,
      );
    } catch {
      return isDataContextValid(context) ? 'retry' : 'forbidden';
    }

    if (response.status === 401) {
      window.dispatchEvent(new Event('mighty-cringe:unauthorized'));
      return 'unauthorized';
    }
    if (
      queued.mutation.type === 'exercise.create' &&
      (response.status === 409 || response.status === 400 || response.status === 404)
    ) {
      return 'retry';
    }
    if (response.status === 409 || response.status === 400 || response.status === 404) {
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        current?: WorkoutRecord | SetRecord | MeasurementRecord | ExercisePreferenceRecord | null;
      };
      await storeConflict(
        prepared,
        payload.current ?? null,
        payload.error ?? 'Сервер не принял изменение',
        context,
      );
      continue;
    }
    if (response.status === 403) return 'forbidden';
    if (!response.ok) return 'retry';

    const result = (await response.json()) as MutationResponse;
    if (!isDataContextValid(context)) return 'forbidden';
    await applyMutationResult(prepared, result, context);
  }
  return 'offline';
}

async function prepareMutation(queued: OutboxMutation, context: DataContext) {
  const db = context.database;
  if (queued.mutation.type === 'workout.update') {
    const workout = await db.workouts.get(queued.mutation.payload.workoutId);
    if (!workout) return null;
    if (workout.revision === 0) {
      if (workout.syncState === 'conflict') return null;
      return restoreMissingWorkoutCreate(queued, workout, context);
    }
  }
  if (queued.mutation.type === 'set.update') {
    const set = await db.sets.get(queued.mutation.payload.setId);
    if (!set || set.revision === 0) return null;
  }
  if (queued.mutation.type === 'set.delete') {
    const set = await db.sets.get(queued.mutation.payload.setId);
    if (!set || set.revision === 0) return null;
  }
  if (
    queued.mutation.type === 'measurement.update' ||
    queued.mutation.type === 'measurement.delete'
  ) {
    const measurement = await db.measurements.get(queued.mutation.payload.measurementId);
    if (!measurement || measurement.revision === 0) return null;
  }
  if (queued.mutation.type === 'exercise-preference.set') {
    const preference = await db.exercisePreferences.get(queued.mutation.payload.exerciseId);
    if (!preference) return null;
  }
  return queued;
}

async function restoreMissingWorkoutCreate(
  blockedUpdate: OutboxMutation,
  workout: LocalWorkout,
  context: DataContext,
): Promise<OutboxMutation> {
  const db = context.database;
  const queuedCreate = await db.outbox
    .filter(
      (item) => item.mutation.type === 'workout.create' && item.mutation.payload.id === workout.id,
    )
    .first();

  if (queuedCreate) {
    if (queuedCreate.sequence >= blockedUpdate.sequence) {
      queuedCreate.sequence = blockedUpdate.sequence - 1;
      await db.outbox.put(queuedCreate);
    }
    return queuedCreate;
  }

  const clientMutationId = crypto.randomUUID();
  const restoredCreate: OutboxMutation = {
    id: clientMutationId,
    sequence: blockedUpdate.sequence - 1,
    createdAt: new Date().toISOString(),
    mutation: {
      type: 'workout.create',
      payload: {
        id: workout.id,
        clientMutationId,
        startedAt: workout.startedAt,
        endedAt: workout.endedAt,
        durationSeconds: workout.durationSeconds,
        activeSegmentStartedAt: workout.activeSegmentStartedAt,
        lastActivityAt: workout.lastActivityAt,
        completionReason: workout.completionReason,
        isFavorite: workout.isFavorite,
        favoriteName: workout.favoriteName,
        notes: workout.notes,
        locale: workout.locale,
        exercises: workout.exercises,
        activityAt: workout.lastActivityAt,
      },
    },
  };
  await db.outbox.put(restoredCreate);
  return restoredCreate;
}

async function applyMutationResult(
  queued: OutboxMutation,
  result: MutationResponse,
  context: DataContext,
) {
  const db = context.database;
  await db.transaction(
    'rw',
    [db.exercises, db.exercisePreferences, db.workouts, db.sets, db.measurements, db.outbox],
    async () => {
      const queuedNow = await db.outbox.get(queued.id);
      if (
        queued.mutation.type === 'workout.create' &&
        result.entityType === 'workout' &&
        result.entity &&
        !queuedNow &&
        !(await db.workouts.get(result.entity.id))
      ) {
        // The athlete deleted this still-local workout while its create request was
        // in flight. Complete that deletion instead of resurrecting the late result.
        const clientMutationId = crypto.randomUUID();
        await db.outbox.put({
          id: clientMutationId,
          sequence: nextSequence(),
          createdAt: new Date().toISOString(),
          mutation: {
            type: 'workout.delete',
            payload: {
              clientMutationId,
              workoutId: result.entity.id,
              baseRevision: result.entity.revision,
            },
          },
        });
        return;
      }
      const remaining = (await db.outbox.toArray()).filter((item) => item.id !== queued.id);
      const hasNewerLocalChange = remaining.some(
        (item) => mutationEntity(item.mutation).key === mutationEntity(queued.mutation).key,
      );

      if (result.entity === null) {
        if (result.entityType === 'workout') {
          await db.sets.where('workoutId').equals(result.entityId).delete();
          await db.workouts.delete(result.entityId);
        } else if (result.entityType === 'set') {
          await db.sets.delete(result.entityId);
        } else {
          await db.measurements.delete(result.entityId);
        }
        await db.outbox.delete(queued.id);
        return;
      }

      // Only our own acknowledged predecessor may advance another queued edit's
      // expected revision. A newer polled cache may contain somebody else's work.
      const previousRevision =
        'baseRevision' in queued.mutation.payload
          ? queued.mutation.payload.baseRevision
          : queued.mutation.type.endsWith('.create')
            ? 0
            : null;
      if (previousRevision !== null && result.entity.revision !== undefined) {
        const entityKey = mutationEntity(queued.mutation).key;
        for (const successor of remaining) {
          if (
            successor.sequence > queued.sequence &&
            mutationEntity(successor.mutation).key === entityKey &&
            'baseRevision' in successor.mutation.payload &&
            successor.mutation.payload.baseRevision === previousRevision
          ) {
            successor.mutation.payload.baseRevision = result.entity.revision;
            await db.outbox.put(successor);
          }
        }
      }

      if (result.entityType === 'exercise') {
        await db.exercises.put({ ...result.entity, syncState: 'synced' });
      } else if (result.entityType === 'exercisePreference') {
        const local = await db.exercisePreferences.get(result.entity.exerciseId);
        if (hasNewerLocalChange && local) {
          await db.exercisePreferences.update(local.exerciseId, {
            revision: result.entity.revision,
            updatedAt: result.entity.updatedAt,
            syncState: 'pending',
          });
        } else {
          await db.exercisePreferences.put({ ...result.entity, syncState: 'synced' });
        }
      } else if (result.entityType === 'workout') {
        const local = await db.workouts.get(result.entity.id);
        if (hasNewerLocalChange && local) {
          await db.workouts.update(local.id, {
            revision: result.entity.revision,
            updatedAt: result.entity.updatedAt,
            syncState: 'pending',
          });
        } else {
          const serverWorkout = withoutSets(result.entity);
          await db.workouts.put({
            ...serverWorkout,
            lastActivityAt:
              local && local.lastActivityAt > serverWorkout.lastActivityAt
                ? local.lastActivityAt
                : serverWorkout.lastActivityAt,
            syncState: 'synced',
          });
        }
        for (const set of result.entity.sets) {
          const localSet = await db.sets.get(set.id);
          if (!localSet || localSet.syncState === 'synced') {
            await db.sets.put({ ...set, deleted: false, syncState: 'synced' });
          }
        }
      } else if (result.entityType === 'set') {
        const local = await db.sets.get(result.entity.id);
        if (hasNewerLocalChange && local) {
          await db.sets.update(local.id, {
            revision: result.entity.revision,
            updatedAt: result.entity.updatedAt,
            syncState: 'pending',
          });
        } else {
          await db.sets.put({ ...result.entity, deleted: false, syncState: 'synced' });
        }
      } else {
        const local = await db.measurements.get(result.entity.id);
        if (hasNewerLocalChange && local) {
          await db.measurements.update(local.id, {
            revision: result.entity.revision,
            updatedAt: result.entity.updatedAt,
            syncState: 'pending',
          });
        } else {
          await db.measurements.put({ ...result.entity, deleted: false, syncState: 'synced' });
        }
      }
      await db.outbox.delete(queued.id);
    },
  );
}

async function storeConflict(
  queued: OutboxMutation,
  current: WorkoutRecord | SetRecord | MeasurementRecord | ExercisePreferenceRecord | null,
  message: string,
  context: DataContext,
) {
  const db = context.database;
  if (queued.mutation.type === 'exercise.create') return;
  const entity = mutationEntity(queued.mutation);
  if (entity.type === 'exercise') return;
  await db.transaction(
    'rw',
    [db.workouts, db.sets, db.measurements, db.exercisePreferences, db.outbox, db.conflicts],
    async () => {
      await markSyncState(queued.mutation, 'conflict', context);
      await db.conflicts.put({
        id: queued.id,
        entityType: entity.type,
        entityId: entity.id,
        createdAt: new Date().toISOString(),
        message,
        mutation: queued.mutation,
        current,
      });
      await db.outbox.delete(queued.id);
    },
  );
}

async function markSyncState(
  mutation: SyncMutation,
  syncState: 'pending' | 'conflict',
  context: DataContext,
) {
  const db = context.database;
  const entity = mutationEntity(mutation);
  if (entity.type === 'workout') {
    await db.workouts.update(entity.id, { syncState });
  } else if (entity.type === 'set') {
    await db.sets.update(entity.id, { syncState });
  } else if (entity.type === 'exercise') {
    await db.exercises.update(entity.id, { syncState });
  } else if (entity.type === 'exercisePreference') {
    await db.exercisePreferences.update(entity.id, { syncState });
  } else {
    await db.measurements.update(entity.id, { syncState });
  }
}

async function applyCurrent(
  current: WorkoutRecord | SetRecord | MeasurementRecord | ExercisePreferenceRecord,
  context: DataContext,
) {
  const db = context.database;
  if (isWorkoutRecord(current)) {
    await db.workouts.put({ ...withoutSets(current), syncState: 'synced' });
    for (const set of current.sets) {
      await db.sets.put({ ...set, deleted: false, syncState: 'synced' });
    }
  } else if (isSetRecord(current)) {
    await db.sets.put({ ...current, deleted: false, syncState: 'synced' });
  } else if (isMeasurementRecord(current)) {
    await db.measurements.put({ ...current, deleted: false, syncState: 'synced' });
  } else {
    await db.exercisePreferences.put({ ...current, syncState: 'synced' });
  }
}

async function rebaseMutation(
  conflict: SyncConflict,
  context: DataContext,
): Promise<SyncMutation | null> {
  const db = context.database;
  const clientMutationId = crypto.randomUUID();
  if (
    conflict.mutation.type === 'workout.create' &&
    conflict.current &&
    isWorkoutRecord(conflict.current)
  ) {
    const local = await db.workouts.get(conflict.mutation.payload.id);
    if (!local) return null;
    return {
      type: 'workout.update',
      payload: {
        clientMutationId,
        workoutId: local.id,
        baseRevision: conflict.current.revision,
        changes: {
          startedAt: local.startedAt,
          endedAt: local.endedAt,
          durationSeconds: local.durationSeconds,
          activeSegmentStartedAt: local.activeSegmentStartedAt,
          lastActivityAt: local.lastActivityAt,
          completionReason: local.completionReason,
          isFavorite: local.isFavorite,
          favoriteName: local.favoriteName,
          notes: local.notes,
          exercises: local.exercises,
        },
        activityAt: local.lastActivityAt,
      },
    };
  }
  if (
    conflict.mutation.type === 'workout.update' &&
    conflict.current &&
    isWorkoutRecord(conflict.current)
  ) {
    const payload: UpdateWorkoutInput = {
      ...conflict.mutation.payload,
      clientMutationId,
      baseRevision: conflict.current.revision,
    };
    return { type: 'workout.update', payload };
  }
  if (
    conflict.mutation.type === 'workout.delete' &&
    conflict.current &&
    isWorkoutRecord(conflict.current)
  ) {
    const payload: DeleteWorkoutInput = {
      ...conflict.mutation.payload,
      clientMutationId,
      baseRevision: conflict.current.revision,
    };
    return { type: 'workout.delete', payload };
  }
  if (
    conflict.mutation.type === 'set.update' &&
    conflict.current &&
    isSetRecord(conflict.current)
  ) {
    const payload: UpdateSetInput = {
      ...conflict.mutation.payload,
      clientMutationId,
      baseRevision: conflict.current.revision,
    };
    return { type: 'set.update', payload };
  }
  if (conflict.mutation.type === 'workout.update' && !conflict.current) {
    const local = await db.workouts.get(conflict.mutation.payload.workoutId);
    if (!local) return null;
    return {
      type: 'workout.create',
      payload: {
        id: local.id,
        clientMutationId,
        startedAt: local.startedAt,
        endedAt: local.endedAt,
        durationSeconds: local.durationSeconds,
        activeSegmentStartedAt: local.activeSegmentStartedAt,
        lastActivityAt: local.lastActivityAt,
        completionReason: local.completionReason,
        isFavorite: local.isFavorite,
        favoriteName: local.favoriteName,
        notes: local.notes,
        locale: local.locale,
        exercises: local.exercises,
        activityAt: local.lastActivityAt,
      },
    };
  }
  if (conflict.mutation.type === 'set.update' && !conflict.current) {
    const local = await db.sets.get(conflict.mutation.payload.setId);
    if (!local || local.deleted) return null;
    return {
      type: 'set.create',
      payload: {
        clientMutationId,
        workoutId: local.workoutId,
        set: {
          id: local.id,
          exerciseId: local.exerciseId,
          weightKg: local.weightKg,
          reps: local.reps,
          rir: local.rir,
          comment: local.comment,
          entrySource: local.entrySource,
          performedAt: local.performedAt,
          position: local.position,
        },
      },
    };
  }
  if (
    conflict.mutation.type === 'set.delete' &&
    conflict.current &&
    isSetRecord(conflict.current)
  ) {
    const payload: DeleteSetInput = {
      ...conflict.mutation.payload,
      clientMutationId,
      baseRevision: conflict.current.revision,
    };
    return { type: 'set.delete', payload };
  }
  if (
    conflict.mutation.type === 'measurement.update' &&
    conflict.current &&
    isMeasurementRecord(conflict.current)
  ) {
    const payload: UpdateMeasurementInput = {
      ...conflict.mutation.payload,
      clientMutationId,
      baseRevision: conflict.current.revision,
    };
    return { type: 'measurement.update', payload };
  }
  if (conflict.mutation.type === 'measurement.update' && !conflict.current) {
    const local = await db.measurements.get(conflict.mutation.payload.measurementId);
    if (!local || local.deleted) return null;
    return {
      type: 'measurement.create',
      payload: {
        id: local.id,
        clientMutationId,
        measuredOn: local.measuredOn,
        isSelfMeasured: local.isSelfMeasured,
        values: local.values,
      },
    };
  }
  if (
    conflict.mutation.type === 'measurement.delete' &&
    conflict.current &&
    isMeasurementRecord(conflict.current)
  ) {
    const payload: DeleteMeasurementInput = {
      ...conflict.mutation.payload,
      clientMutationId,
      baseRevision: conflict.current.revision,
    };
    return { type: 'measurement.delete', payload };
  }
  if (conflict.mutation.type === 'exercise-preference.set') {
    const local = await db.exercisePreferences.get(conflict.mutation.payload.exerciseId);
    if (!local) return null;
    const payload: SetExercisePreferenceInput = {
      ...conflict.mutation.payload,
      clientMutationId,
      baseRevision:
        conflict.current && isExercisePreferenceRecord(conflict.current)
          ? conflict.current.revision
          : 0,
      value: local.value,
    };
    return { type: 'exercise-preference.set', payload };
  }
  return null;
}

function mutationEntity(mutation: SyncMutation) {
  switch (mutation.type) {
    case 'exercise.create':
      return {
        type: 'exercise' as const,
        id: mutation.payload.id,
        key: `exercise:${mutation.payload.id}`,
      };
    case 'exercise-preference.set':
      return {
        type: 'exercisePreference' as const,
        id: mutation.payload.exerciseId,
        key: `exercisePreference:${mutation.payload.exerciseId}`,
      };
    case 'workout.create':
      return {
        type: 'workout' as const,
        id: mutation.payload.id,
        key: `workout:${mutation.payload.id}`,
      };
    case 'workout.update':
    case 'workout.touch':
      return {
        type: 'workout' as const,
        id: mutation.payload.workoutId,
        key: `workout:${mutation.payload.workoutId}`,
      };
    case 'workout.delete':
      return {
        type: 'workout' as const,
        id: mutation.payload.workoutId,
        key: `workout:${mutation.payload.workoutId}`,
      };
    case 'set.create':
      return {
        type: 'set' as const,
        id: mutation.payload.set.id,
        key: `set:${mutation.payload.set.id}`,
      };
    case 'set.update':
      return {
        type: 'set' as const,
        id: mutation.payload.setId,
        key: `set:${mutation.payload.setId}`,
      };
    case 'set.delete':
      return {
        type: 'set' as const,
        id: mutation.payload.setId,
        key: `set:${mutation.payload.setId}`,
      };
    case 'measurement.create':
      return {
        type: 'measurement' as const,
        id: mutation.payload.id,
        key: `measurement:${mutation.payload.id}`,
      };
    case 'measurement.update':
    case 'measurement.delete':
      return {
        type: 'measurement' as const,
        id: mutation.payload.measurementId,
        key: `measurement:${mutation.payload.measurementId}`,
      };
  }
}

function isWorkoutRecord(
  current: WorkoutRecord | SetRecord | MeasurementRecord | ExercisePreferenceRecord,
): current is WorkoutRecord {
  return 'sets' in current;
}

function isSetRecord(
  current: WorkoutRecord | SetRecord | MeasurementRecord | ExercisePreferenceRecord,
): current is SetRecord {
  return 'workoutId' in current;
}

function isMeasurementRecord(
  current: WorkoutRecord | SetRecord | MeasurementRecord | ExercisePreferenceRecord,
): current is MeasurementRecord {
  return 'values' in current;
}

function isExercisePreferenceRecord(
  current: WorkoutRecord | SetRecord | MeasurementRecord | ExercisePreferenceRecord,
): current is ExercisePreferenceRecord {
  return 'exerciseId' in current && !('workoutId' in current);
}

function withoutSets(workout: WorkoutRecord) {
  const { sets: _sets, ...record } = workout;
  return record;
}

function nextSequence() {
  lastSequence = Math.max(Date.now() * 1_000, lastSequence + 1);
  return lastSequence;
}

async function finishSync(outcome: SyncOutcome, context: DataContext) {
  const state = stateFor(context);
  if (!isDataContextValid(context)) outcome = 'forbidden';
  if (outcome === 'success') {
    state.retryAttempt = 0;
    if (state.retryTimer) clearTimeout(state.retryTimer);
    state.retryTimer = null;
    const completedAt = new Date().toISOString();
    await context.database.meta
      .put({ key: 'lastSuccessfulSyncAt', value: completedAt })
      .catch(() => undefined);
    updateSyncStatus({ phase: 'idle', message: null }, context);
    return;
  }
  if (outcome === 'offline') {
    updateSyncStatus({ phase: 'offline', message: null }, context);
    return;
  }
  if (outcome === 'unauthorized' || outcome === 'forbidden') {
    if (state.retryTimer) clearTimeout(state.retryTimer);
    state.retryTimer = null;
    updateSyncStatus(
      {
        phase: 'error',
        message:
          outcome === 'forbidden'
            ? 'Доступ к подопечному изменился. Неотправленные изменения сохранены отдельно.'
            : 'Сессия истекла — войди снова.',
      },
      context,
    );
    return;
  }
  updateSyncStatus(
    { phase: 'error', message: 'Сервер пока недоступен. Данные сохранены на этом устройстве.' },
    context,
  );
  scheduleRetry(context);
}

function scheduleRetry(context: DataContext) {
  const state = stateFor(context);
  if (state.retryTimer || !browserOnline() || !isDataContextValid(context)) return;
  const delay = Math.min(2_000 * 2 ** state.retryAttempt, 60_000);
  state.retryAttempt += 1;
  state.retryTimer = setTimeout(() => {
    state.retryTimer = null;
    if (isDataContextValid(context)) void syncAll(context);
  }, delay);
  if (typeof state.retryTimer === 'object' && 'unref' in state.retryTimer) state.retryTimer.unref();
}

function combineOutcomes(outcomes: SyncOutcome[]): SyncOutcome {
  if (outcomes.includes('forbidden')) return 'forbidden';
  if (outcomes.includes('unauthorized')) return 'unauthorized';
  if (outcomes.includes('offline')) return 'offline';
  if (outcomes.includes('retry')) return 'retry';
  return 'success';
}

function browserOnline() {
  return typeof navigator === 'undefined' || navigator.onLine !== false;
}

function updateSyncStatus(next: SyncStatus, context: DataContext) {
  const state = stateFor(context);
  if (state.status.phase === next.phase && state.status.message === next.message) return;
  state.status = next;
  for (const listener of syncListeners) listener();
}
