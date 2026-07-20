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

export class MightyCringeDatabase extends Dexie {
  workouts!: EntityTable<LocalWorkout, 'id'>;
  sets!: EntityTable<LocalSet, 'id'>;
  exercises!: EntityTable<Exercise, 'id'>;
  outbox!: EntityTable<OutboxMutation, 'id'>;

  constructor() {
    super('mighty-cringe');
    this.version(1).stores({
      workouts: 'id, startedAt, syncState',
      sets: 'id, workoutId, exerciseId, performedAt, syncState',
      exercises: 'id, *primaryMuscles',
      outbox: 'id, createdAt',
    });
  }
}

export const db = new MightyCringeDatabase();
