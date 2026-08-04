import type {
  DeleteMeasurementInput,
  DeleteSetInput,
  DeleteWorkoutInput,
  Exercise,
  MeasurementRecord,
  SetRecord,
  SyncMutation,
  UpdateMeasurementInput,
  UpdateSetInput,
  UpdateWorkoutInput,
  WorkoutRecord,
} from '@mighty-cringe/contracts';

import { db, type LocalWorkout, type OutboxMutation, type SyncConflict } from './db';
import { flushVoiceQueue, refreshVoiceEntries } from './voice';

type MutationResponse =
  | { entityType: 'exercise'; entity: Exercise; duplicate: boolean }
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

type SyncOutcome = 'success' | 'offline' | 'retry' | 'unauthorized';

let lastSequence = 0;
let activeFlush: Promise<SyncOutcome> | null = null;
let retryAttempt = 0;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let syncStatus: SyncStatus = browserOnline()
  ? { phase: 'idle', message: null }
  : { phase: 'offline', message: null };
const syncListeners = new Set<() => void>();

export function getSyncStatus() {
  return syncStatus;
}

export function subscribeSyncStatus(listener: () => void) {
  syncListeners.add(listener);
  return () => syncListeners.delete(listener);
}

export async function queueMutation(mutation: SyncMutation) {
  const id = mutation.payload.clientMutationId;
  await db.outbox.put({
    id,
    sequence: nextSequence(),
    createdAt: new Date().toISOString(),
    mutation,
  });
  if (browserOnline()) setTimeout(() => void flushOutbox(), 0);
}

export function flushOutbox() {
  if (activeFlush) return activeFlush;
  updateSyncStatus(
    browserOnline() ? { phase: 'syncing', message: null } : { phase: 'offline', message: null },
  );
  activeFlush = performFlush()
    .catch(() => 'retry' as const)
    .then(async (outcome) => {
      await finishSync(outcome);
      return outcome;
    })
    .finally(() => {
      activeFlush = null;
    });
  return activeFlush;
}

export async function syncAll() {
  const flushOutcome = await flushOutbox();
  if (flushOutcome !== 'success') return flushOutcome;
  const voiceOutcome = await flushVoiceQueue();
  if (voiceOutcome !== 'success') {
    await finishSync(voiceOutcome);
    return voiceOutcome;
  }
  updateSyncStatus({ phase: 'syncing', message: null });
  const refreshOutcome = await refreshHistory().catch(() => 'retry' as const);
  await finishSync(refreshOutcome);
  return refreshOutcome;
}

export async function refreshHistory(): Promise<SyncOutcome> {
  if (!browserOnline()) return 'offline';

  const outcomes = await Promise.all([
    refreshWorkoutHistory(),
    refreshMeasurementHistory(),
    refreshVoiceEntries(),
  ]);
  return combineOutcomes(outcomes);
}

async function refreshWorkoutHistory(): Promise<SyncOutcome> {
  let response: Response;
  try {
    response = await fetch('/api/v1/workouts', { credentials: 'same-origin' });
  } catch {
    return 'retry';
  }
  if (response.status === 401) {
    window.dispatchEvent(new Event('mighty-cringe:unauthorized'));
    return 'unauthorized';
  }
  if (!response.ok) return 'retry';

  const payload = (await response.json()) as { items: WorkoutRecord[] };
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

async function refreshMeasurementHistory(): Promise<SyncOutcome> {
  let response: Response;
  try {
    response = await fetch('/api/v1/measurements', { credentials: 'same-origin' });
  } catch {
    return 'retry';
  }
  if (response.status === 401) {
    window.dispatchEvent(new Event('mighty-cringe:unauthorized'));
    return 'unauthorized';
  }
  if (!response.ok) return 'retry';

  const payload = (await response.json()) as { items: MeasurementRecord[] };
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

export async function resolveConflict(conflictId: string, strategy: 'server' | 'mine') {
  const conflict = await db.conflicts.get(conflictId);
  if (!conflict) return;

  if (strategy === 'server') {
    await db.transaction('rw', db.workouts, db.sets, db.measurements, db.conflicts, async () => {
      if (conflict.current) {
        await applyCurrent(conflict.current);
      } else if (conflict.entityType === 'workout') {
        await db.sets.where('workoutId').equals(conflict.entityId).delete();
        await db.workouts.delete(conflict.entityId);
      } else if (conflict.entityType === 'set') {
        await db.sets.delete(conflict.entityId);
      } else {
        await db.measurements.delete(conflict.entityId);
      }
      await db.conflicts.delete(conflict.id);
    });
    return;
  }

  const rebased = await rebaseMutation(conflict);
  if (!rebased) return;
  await db.transaction(
    'rw',
    db.workouts,
    db.sets,
    db.measurements,
    db.outbox,
    db.conflicts,
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
        } else {
          await db.measurements.update(conflict.entityId, {
            revision: conflict.current.revision,
            updatedAt: conflict.current.updatedAt,
          });
        }
      }
      await markSyncState(rebased, 'pending');
      await db.outbox.put({
        id: rebased.payload.clientMutationId,
        sequence: nextSequence(),
        createdAt: new Date().toISOString(),
        mutation: rebased,
      });
      await db.conflicts.delete(conflict.id);
    },
  );
  await flushOutbox();
}

async function performFlush(): Promise<SyncOutcome> {
  if (!browserOnline()) return 'offline';

  while (browserOnline()) {
    const queued = await db.outbox.orderBy('sequence').first();
    if (!queued) return 'success';
    const prepared = await prepareMutation(queued);
    if (!prepared) return 'retry';

    let response: Response;
    try {
      response = await fetch('/api/v1/sync', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(prepared.mutation),
      });
    } catch {
      return 'retry';
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
        current?: WorkoutRecord | SetRecord | MeasurementRecord | null;
      };
      await storeConflict(
        prepared,
        payload.current ?? null,
        payload.error ?? 'Сервер не принял изменение',
      );
      continue;
    }
    if (!response.ok) return 'retry';

    const result = (await response.json()) as MutationResponse;
    await applyMutationResult(prepared, result);
  }
  return 'offline';
}

async function prepareMutation(queued: OutboxMutation) {
  if (queued.mutation.type === 'workout.update') {
    const workout = await db.workouts.get(queued.mutation.payload.workoutId);
    if (!workout) return null;
    if (workout.revision === 0) {
      if (workout.syncState === 'conflict') return null;
      return restoreMissingWorkoutCreate(queued, workout);
    }
    if (queued.mutation.payload.baseRevision !== workout.revision) {
      queued.mutation.payload.baseRevision = workout.revision;
      await db.outbox.put(queued);
    }
  }
  if (queued.mutation.type === 'set.update') {
    const set = await db.sets.get(queued.mutation.payload.setId);
    if (!set || set.revision === 0) return null;
    if (queued.mutation.payload.baseRevision !== set.revision) {
      queued.mutation.payload.baseRevision = set.revision;
      await db.outbox.put(queued);
    }
  }
  if (queued.mutation.type === 'set.delete') {
    const set = await db.sets.get(queued.mutation.payload.setId);
    if (!set || set.revision === 0) return null;
    if (queued.mutation.payload.baseRevision !== set.revision) {
      queued.mutation.payload.baseRevision = set.revision;
      await db.outbox.put(queued);
    }
  }
  if (
    queued.mutation.type === 'measurement.update' ||
    queued.mutation.type === 'measurement.delete'
  ) {
    const measurement = await db.measurements.get(queued.mutation.payload.measurementId);
    if (!measurement || measurement.revision === 0) return null;
    if (queued.mutation.payload.baseRevision !== measurement.revision) {
      queued.mutation.payload.baseRevision = measurement.revision;
      await db.outbox.put(queued);
    }
  }
  return queued;
}

async function restoreMissingWorkoutCreate(
  blockedUpdate: OutboxMutation,
  workout: LocalWorkout,
): Promise<OutboxMutation> {
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

async function applyMutationResult(queued: OutboxMutation, result: MutationResponse) {
  await db.transaction(
    'rw',
    db.exercises,
    db.workouts,
    db.sets,
    db.measurements,
    db.outbox,
    async () => {
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

      if (result.entityType === 'exercise') {
        await db.exercises.put({ ...result.entity, syncState: 'synced' });
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
  current: WorkoutRecord | SetRecord | MeasurementRecord | null,
  message: string,
) {
  if (queued.mutation.type === 'exercise.create') return;
  const entity = mutationEntity(queued.mutation);
  if (entity.type === 'exercise') return;
  await db.transaction(
    'rw',
    db.workouts,
    db.sets,
    db.measurements,
    db.outbox,
    db.conflicts,
    async () => {
      await markSyncState(queued.mutation, 'conflict');
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

async function markSyncState(mutation: SyncMutation, syncState: 'pending' | 'conflict') {
  const entity = mutationEntity(mutation);
  if (entity.type === 'workout') {
    await db.workouts.update(entity.id, { syncState });
  } else if (entity.type === 'set') {
    await db.sets.update(entity.id, { syncState });
  } else if (entity.type === 'exercise') {
    await db.exercises.update(entity.id, { syncState });
  } else {
    await db.measurements.update(entity.id, { syncState });
  }
}

async function applyCurrent(current: WorkoutRecord | SetRecord | MeasurementRecord) {
  if (isWorkoutRecord(current)) {
    await db.workouts.put({ ...withoutSets(current), syncState: 'synced' });
    for (const set of current.sets) {
      await db.sets.put({ ...set, deleted: false, syncState: 'synced' });
    }
  } else if (isSetRecord(current)) {
    await db.sets.put({ ...current, deleted: false, syncState: 'synced' });
  } else {
    await db.measurements.put({ ...current, deleted: false, syncState: 'synced' });
  }
}

async function rebaseMutation(conflict: SyncConflict): Promise<SyncMutation | null> {
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
  current: WorkoutRecord | SetRecord | MeasurementRecord,
): current is WorkoutRecord {
  return 'sets' in current;
}

function isSetRecord(current: WorkoutRecord | SetRecord | MeasurementRecord): current is SetRecord {
  return 'workoutId' in current;
}

function isMeasurementRecord(
  current: WorkoutRecord | SetRecord | MeasurementRecord,
): current is MeasurementRecord {
  return !isWorkoutRecord(current) && !isSetRecord(current);
}

function withoutSets(workout: WorkoutRecord) {
  const { sets: _sets, ...record } = workout;
  return record;
}

function nextSequence() {
  lastSequence = Math.max(Date.now() * 1_000, lastSequence + 1);
  return lastSequence;
}

async function finishSync(outcome: SyncOutcome) {
  if (outcome === 'success') {
    retryAttempt = 0;
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = null;
    const completedAt = new Date().toISOString();
    await db.meta.put({ key: 'lastSuccessfulSyncAt', value: completedAt }).catch(() => undefined);
    updateSyncStatus({ phase: 'idle', message: null });
    return;
  }
  if (outcome === 'offline') {
    updateSyncStatus({ phase: 'offline', message: null });
    return;
  }
  if (outcome === 'unauthorized') {
    updateSyncStatus({ phase: 'error', message: 'Сессия истекла — войди снова.' });
    return;
  }

  updateSyncStatus({
    phase: 'error',
    message: 'Сервер пока недоступен. Данные сохранены на этом устройстве.',
  });
  scheduleRetry();
}

function scheduleRetry() {
  if (retryTimer || !browserOnline()) return;
  const delay = Math.min(2_000 * 2 ** retryAttempt, 60_000);
  retryAttempt += 1;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    void syncAll();
  }, delay);
  if (typeof retryTimer === 'object' && 'unref' in retryTimer) retryTimer.unref();
}

function combineOutcomes(outcomes: SyncOutcome[]): SyncOutcome {
  if (outcomes.includes('unauthorized')) return 'unauthorized';
  if (outcomes.includes('offline')) return 'offline';
  if (outcomes.includes('retry')) return 'retry';
  return 'success';
}

function browserOnline() {
  return typeof navigator === 'undefined' || navigator.onLine !== false;
}

function updateSyncStatus(next: SyncStatus) {
  if (syncStatus.phase === next.phase && syncStatus.message === next.message) return;
  syncStatus = next;
  for (const listener of syncListeners) listener();
}
