import Dexie, { type EntityTable } from 'dexie';

import type { Exercise, SetInput, SyncMutation } from '@mighty-cringe/contracts';

export type LocalWorkout = {
  id: string;
  startedAt: string;
  endedAt: string | null;
  syncState: 'pending' | 'synced';
};

export type LocalSet = SetInput & {
  workoutId: string;
  syncState: 'pending' | 'synced';
};

export type OutboxMutation = {
  id: string;
  createdAt: string;
  mutation: SyncMutation;
};

type LocalMeta = {
  key: string;
  value: string;
};

export class MightyCringeDatabase extends Dexie {
  workouts!: EntityTable<LocalWorkout, 'id'>;
  sets!: EntityTable<LocalSet, 'id'>;
  exercises!: EntityTable<Exercise, 'id'>;
  outbox!: EntityTable<OutboxMutation, 'id'>;
  meta!: EntityTable<LocalMeta, 'key'>;

  constructor() {
    super('mighty-cringe');
    this.version(1).stores({
      workouts: 'id, startedAt, syncState',
      sets: 'id, workoutId, exerciseId, performedAt, syncState',
      exercises: 'id, *primaryMuscles',
      outbox: 'id, createdAt',
    });
    this.version(2).stores({
      workouts: 'id, startedAt, syncState',
      sets: 'id, workoutId, exerciseId, performedAt, syncState',
      exercises: 'id, *primaryMuscles',
      outbox: 'id, createdAt',
      meta: 'key',
    });
  }
}

export const db = new MightyCringeDatabase();

export async function activateLocalUser(userId: string) {
  const activeUser = await db.meta.get('activeUserId');
  if (activeUser?.value === userId) return;

  await db.transaction('rw', db.workouts, db.sets, db.outbox, db.meta, async () => {
    await Promise.all([db.workouts.clear(), db.sets.clear(), db.outbox.clear()]);
    await db.meta.put({ key: 'activeUserId', value: userId });
  });
}

export async function clearLocalUserData() {
  await db.transaction('rw', db.workouts, db.sets, db.outbox, db.meta, async () => {
    await Promise.all([db.workouts.clear(), db.sets.clear(), db.outbox.clear()]);
    await db.meta.delete('activeUserId');
  });
}
