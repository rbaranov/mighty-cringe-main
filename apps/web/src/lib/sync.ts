import type {
  SetRecord,
  SyncMutation,
  UpdateSetInput,
  UpdateWorkoutInput,
  WorkoutRecord,
} from '@mighty-cringe/contracts';

import { db, type OutboxMutation, type SyncConflict } from './db';

type MutationResponse =
  | { entityType: 'workout'; entity: WorkoutRecord; duplicate: boolean }
  | { entityType: 'set'; entity: SetRecord; duplicate: boolean };

let lastSequence = 0;
let activeFlush: Promise<void> | null = null;

export async function queueMutation(mutation: SyncMutation) {
  const id = mutation.payload.clientMutationId;
  await db.outbox.put({
    id,
    sequence: nextSequence(),
    createdAt: new Date().toISOString(),
    mutation,
  });
  if (navigator.onLine) setTimeout(() => void flushOutbox(), 0);
}

export function flushOutbox() {
  if (activeFlush) return activeFlush;
  activeFlush = performFlush().finally(() => {
    activeFlush = null;
  });
  return activeFlush;
}

export async function syncAll() {
  await flushOutbox();
  await refreshHistory();
}

export async function refreshHistory() {
  if (!navigator.onLine) return;

  let response: Response;
  try {
    response = await fetch('/api/v1/workouts', { credentials: 'same-origin' });
  } catch {
    return;
  }
  if (response.status === 401) {
    window.dispatchEvent(new Event('mighty-cringe:unauthorized'));
    return;
  }
  if (!response.ok) return;

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
          await db.sets.put({ ...set, syncState: 'synced' });
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
}

export async function resolveConflict(conflictId: string, strategy: 'server' | 'mine') {
  const conflict = await db.conflicts.get(conflictId);
  if (!conflict) return;

  if (strategy === 'server') {
    await db.transaction('rw', db.workouts, db.sets, db.conflicts, async () => {
      if (conflict.current) {
        await applyCurrent(conflict.current);
      } else if (conflict.entityType === 'workout') {
        await db.sets.where('workoutId').equals(conflict.entityId).delete();
        await db.workouts.delete(conflict.entityId);
      } else {
        await db.sets.delete(conflict.entityId);
      }
      await db.conflicts.delete(conflict.id);
    });
    return;
  }

  const rebased = await rebaseMutation(conflict);
  if (!rebased) return;
  await db.transaction('rw', db.workouts, db.sets, db.outbox, db.conflicts, async () => {
    if (conflict.current) {
      if ('sets' in conflict.current) {
        await db.workouts.update(conflict.entityId, {
          revision: conflict.current.revision,
          updatedAt: conflict.current.updatedAt,
        });
      } else {
        await db.sets.update(conflict.entityId, {
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
  });
  await flushOutbox();
}

async function performFlush() {
  if (!navigator.onLine) return;

  while (navigator.onLine) {
    const queued = await db.outbox.orderBy('sequence').first();
    if (!queued) return;
    const prepared = await prepareMutation(queued);
    if (!prepared) return;

    let response: Response;
    try {
      response = await fetch('/api/v1/sync', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(prepared.mutation),
      });
    } catch {
      return;
    }

    if (response.status === 401) {
      window.dispatchEvent(new Event('mighty-cringe:unauthorized'));
      return;
    }
    if (response.status === 409 || response.status === 400 || response.status === 404) {
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        current?: WorkoutRecord | SetRecord | null;
      };
      await storeConflict(
        prepared,
        payload.current ?? null,
        payload.error ?? 'Сервер не принял изменение',
      );
      continue;
    }
    if (!response.ok) return;

    const result = (await response.json()) as MutationResponse;
    await applyMutationResult(prepared, result);
  }
}

async function prepareMutation(queued: OutboxMutation) {
  if (queued.mutation.type === 'workout.update') {
    const workout = await db.workouts.get(queued.mutation.payload.workoutId);
    if (!workout || workout.revision === 0) return null;
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
  return queued;
}

async function applyMutationResult(queued: OutboxMutation, result: MutationResponse) {
  await db.transaction('rw', db.workouts, db.sets, db.outbox, async () => {
    const remaining = (await db.outbox.toArray()).filter((item) => item.id !== queued.id);
    const hasNewerLocalChange = remaining.some(
      (item) => mutationEntity(item.mutation).key === mutationEntity(queued.mutation).key,
    );

    if (result.entityType === 'workout') {
      const local = await db.workouts.get(result.entity.id);
      if (hasNewerLocalChange && local) {
        await db.workouts.update(local.id, {
          revision: result.entity.revision,
          updatedAt: result.entity.updatedAt,
          syncState: 'pending',
        });
      } else {
        await db.workouts.put({ ...withoutSets(result.entity), syncState: 'synced' });
      }
      for (const set of result.entity.sets) {
        const localSet = await db.sets.get(set.id);
        if (!localSet || localSet.syncState === 'synced') {
          await db.sets.put({ ...set, syncState: 'synced' });
        }
      }
    } else {
      const local = await db.sets.get(result.entity.id);
      if (hasNewerLocalChange && local) {
        await db.sets.update(local.id, {
          revision: result.entity.revision,
          updatedAt: result.entity.updatedAt,
          syncState: 'pending',
        });
      } else {
        await db.sets.put({ ...result.entity, syncState: 'synced' });
      }
    }
    await db.outbox.delete(queued.id);
  });
}

async function storeConflict(
  queued: OutboxMutation,
  current: WorkoutRecord | SetRecord | null,
  message: string,
) {
  const entity = mutationEntity(queued.mutation);
  await db.transaction('rw', db.workouts, db.sets, db.outbox, db.conflicts, async () => {
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
  });
}

async function markSyncState(mutation: SyncMutation, syncState: 'pending' | 'conflict') {
  const entity = mutationEntity(mutation);
  if (entity.type === 'workout') {
    await db.workouts.update(entity.id, { syncState });
  } else {
    await db.sets.update(entity.id, { syncState });
  }
}

async function applyCurrent(current: WorkoutRecord | SetRecord) {
  if ('sets' in current) {
    await db.workouts.put({ ...withoutSets(current), syncState: 'synced' });
    for (const set of current.sets) await db.sets.put({ ...set, syncState: 'synced' });
  } else {
    await db.sets.put({ ...current, syncState: 'synced' });
  }
}

async function rebaseMutation(conflict: SyncConflict): Promise<SyncMutation | null> {
  const clientMutationId = crypto.randomUUID();
  if (
    conflict.mutation.type === 'workout.update' &&
    conflict.current &&
    'sets' in conflict.current
  ) {
    const payload: UpdateWorkoutInput = {
      ...conflict.mutation.payload,
      clientMutationId,
      baseRevision: conflict.current.revision,
    };
    return { type: 'workout.update', payload };
  }
  if (
    conflict.mutation.type === 'set.update' &&
    conflict.current &&
    !('sets' in conflict.current)
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
        notes: local.notes,
        locale: local.locale,
      },
    };
  }
  if (conflict.mutation.type === 'set.update' && !conflict.current) {
    const local = await db.sets.get(conflict.mutation.payload.setId);
    if (!local) return null;
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
          performedAt: local.performedAt,
        },
      },
    };
  }
  return null;
}

function mutationEntity(mutation: SyncMutation) {
  switch (mutation.type) {
    case 'workout.create':
      return {
        type: 'workout' as const,
        id: mutation.payload.id,
        key: `workout:${mutation.payload.id}`,
      };
    case 'workout.update':
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
  }
}

function withoutSets(workout: WorkoutRecord) {
  const { sets: _sets, ...record } = workout;
  return record;
}

function nextSequence() {
  lastSequence = Math.max(Date.now() * 1_000, lastSequence + 1);
  return lastSequence;
}
