import Dexie, { type EntityTable } from 'dexie';

import type {
  CurrentUser,
  Exercise,
  MeasurementRecord,
  SetRecord,
  SyncMutation,
  VoiceEntryRecord,
  WorkoutRecord,
} from '@mighty-cringe/contracts';

import { parseCurrentUser } from './user';

export type SyncState = 'pending' | 'synced' | 'conflict';

export type LocalWorkout = Omit<WorkoutRecord, 'sets'> & {
  syncState: SyncState;
};

export type LocalSet = SetRecord & {
  syncState: SyncState;
  deleted: boolean;
};

export type LocalMeasurement = MeasurementRecord & {
  syncState: SyncState;
  deleted: boolean;
};

export type LocalExercise = Exercise & {
  syncState?: SyncState;
};

export type LocalVoiceStatus = VoiceEntryRecord['status'] | 'queued' | 'uploading' | 'deleting';

export type LocalVoiceEntry = Omit<VoiceEntryRecord, 'status'> & {
  status: LocalVoiceStatus;
  audio: Blob | null;
  mimeType: string;
  consentVersion: string;
  serverStored: boolean;
  uploadAttempts: number;
  retryable: boolean;
  nextAttemptAt: string | null;
};

export type OutboxMutation = {
  id: string;
  sequence: number;
  createdAt: string;
  mutation: SyncMutation;
};

export type SyncConflict = {
  id: string;
  entityType: 'workout' | 'set' | 'measurement';
  entityId: string;
  createdAt: string;
  message: string;
  mutation: SyncMutation;
  current: WorkoutRecord | SetRecord | MeasurementRecord | null;
};

type LocalMeta = {
  key: string;
  value: string;
};

export class MightyCringeDatabase extends Dexie {
  workouts!: EntityTable<LocalWorkout, 'id'>;
  sets!: EntityTable<LocalSet, 'id'>;
  exercises!: EntityTable<LocalExercise, 'id'>;
  measurements!: EntityTable<LocalMeasurement, 'id'>;
  voiceEntries!: EntityTable<LocalVoiceEntry, 'id'>;
  outbox!: EntityTable<OutboxMutation, 'id'>;
  conflicts!: EntityTable<SyncConflict, 'id'>;
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
    this.version(3)
      .stores({
        workouts: 'id, startedAt, syncState',
        sets: 'id, workoutId, exerciseId, performedAt, syncState',
        exercises: 'id, *primaryMuscles',
        outbox: 'id, sequence, createdAt',
        conflicts: 'id, entityType, entityId, createdAt',
        meta: 'key',
      })
      .upgrade(async (transaction) => {
        let sequence = Date.now() * 1_000;
        await transaction
          .table('outbox')
          .orderBy('createdAt')
          .modify((queued) => {
            queued.sequence = sequence++;
          });
        await transaction
          .table('workouts')
          .toCollection()
          .modify((workout) => {
            workout.notes ??= null;
            workout.locale ??= 'ru';
            workout.revision ??= workout.syncState === 'synced' ? 1 : 0;
            workout.updatedAt ??= workout.startedAt;
          });
        await transaction
          .table('sets')
          .toCollection()
          .modify((set) => {
            set.revision ??= set.syncState === 'synced' ? 1 : 0;
            set.updatedAt ??= set.performedAt;
          });
      });
    this.version(4)
      .stores({
        workouts: 'id, startedAt, syncState',
        sets: 'id, workoutId, exerciseId, performedAt, position, syncState, deleted',
        exercises: 'id, *primaryMuscles',
        outbox: 'id, sequence, createdAt',
        conflicts: 'id, entityType, entityId, createdAt',
        meta: 'key',
      })
      .upgrade(async (transaction) => {
        await transaction
          .table('workouts')
          .toCollection()
          .modify((workout) => {
            workout.exercises ??= [];
          });
        const positionByExercise = new Map<string, number>();
        await transaction
          .table('sets')
          .orderBy('performedAt')
          .modify((set) => {
            const key = `${set.workoutId}:${set.exerciseId}`;
            set.position ??= positionByExercise.get(key) ?? 0;
            positionByExercise.set(key, set.position + 1);
            set.deleted ??= false;
          });
      });
    this.version(5).stores({
      workouts: 'id, startedAt, syncState',
      sets: 'id, workoutId, exerciseId, performedAt, position, syncState, deleted',
      exercises: 'id, *primaryMuscles',
      measurements: 'id, measuredOn, syncState, deleted',
      outbox: 'id, sequence, createdAt',
      conflicts: 'id, entityType, entityId, createdAt',
      meta: 'key',
    });
    this.version(6).stores({
      workouts: 'id, startedAt, syncState',
      sets: 'id, workoutId, exerciseId, performedAt, position, syncState, deleted',
      exercises: 'id, *primaryMuscles',
      measurements: 'id, measuredOn, syncState, deleted',
      voiceEntries: 'id, workoutId, status, createdAt, nextAttemptAt',
      outbox: 'id, sequence, createdAt',
      conflicts: 'id, entityType, entityId, createdAt',
      meta: 'key',
    });
    this.version(7)
      .stores({
        workouts: 'id, startedAt, syncState',
        sets: 'id, workoutId, exerciseId, performedAt, position, syncState, deleted',
        exercises: 'id, *primaryMuscles',
        measurements: 'id, measuredOn, syncState, deleted',
        voiceEntries: 'id, workoutId, status, createdAt, nextAttemptAt',
        outbox: 'id, sequence, createdAt',
        conflicts: 'id, entityType, entityId, createdAt',
        meta: 'key',
      })
      .upgrade(async (transaction) => {
        await transaction
          .table('sets')
          .toCollection()
          .modify((set) => {
            set.entrySource ??= 'manual';
          });
      });
    this.version(8)
      .stores({
        workouts: 'id, startedAt, syncState',
        sets: 'id, workoutId, exerciseId, performedAt, position, syncState, deleted',
        exercises: 'id, *primaryMuscles',
        measurements: 'id, measuredOn, syncState, deleted',
        voiceEntries: 'id, workoutId, status, createdAt, nextAttemptAt',
        outbox: 'id, sequence, createdAt',
        conflicts: 'id, entityType, entityId, createdAt',
        meta: 'key',
      })
      .upgrade(async (transaction) => {
        await transaction
          .table('measurements')
          .toCollection()
          .modify((measurement) => {
            measurement.values.bodyFatPercent ??= null;
            measurement.values.rfmSex ??= null;
          });
      });
    this.version(9)
      .stores({
        workouts: 'id, startedAt, syncState',
        sets: 'id, workoutId, exerciseId, performedAt, position, syncState, deleted',
        exercises: 'id, *primaryMuscles',
        measurements: 'id, measuredOn, syncState, deleted',
        voiceEntries: 'id, workoutId, status, createdAt, nextAttemptAt',
        outbox: 'id, sequence, createdAt',
        conflicts: 'id, entityType, entityId, createdAt',
        meta: 'key',
      })
      .upgrade(async (transaction) => {
        const storedSets = await transaction.table('sets').toArray();
        const activityByWorkout = new Map<string, string>();
        for (const set of storedSets) {
          const activityAt = [set.performedAt, set.updatedAt]
            .filter((value): value is string => typeof value === 'string')
            .sort()
            .at(-1);
          if (!activityAt) continue;
          const current = activityByWorkout.get(set.workoutId);
          if (!current || activityAt > current) activityByWorkout.set(set.workoutId, activityAt);
        }

        await transaction
          .table('workouts')
          .toCollection()
          .modify((workout) => {
            const endedAt = typeof workout.endedAt === 'string' ? workout.endedAt : null;
            const storedDuration = endedAt
              ? Math.max(
                  0,
                  Math.floor(
                    (new Date(endedAt).getTime() - new Date(workout.startedAt).getTime()) / 1_000,
                  ),
                )
              : 0;
            workout.durationSeconds ??= storedDuration;
            workout.activeSegmentStartedAt ??= endedAt ? null : workout.startedAt;
            workout.lastActivityAt ??= [
              workout.startedAt,
              workout.updatedAt,
              endedAt,
              activityByWorkout.get(workout.id),
            ]
              .filter((value): value is string => typeof value === 'string')
              .sort()
              .at(-1);
            workout.completionReason ??= null;
          });
      });
    this.version(10)
      .stores({
        workouts: 'id, startedAt, syncState',
        sets: 'id, workoutId, exerciseId, performedAt, position, syncState, deleted',
        exercises: 'id, *primaryMuscles',
        measurements: 'id, measuredOn, syncState, deleted',
        voiceEntries: 'id, workoutId, status, createdAt, nextAttemptAt',
        outbox: 'id, sequence, createdAt',
        conflicts: 'id, entityType, entityId, createdAt',
        meta: 'key',
      })
      .upgrade(async (transaction) => {
        await transaction
          .table('workouts')
          .toCollection()
          .modify((workout) => {
            workout.isFavorite ??= false;
          });
      });
  }
}

export const db = new MightyCringeDatabase();

export async function activateLocalUser(userId: string) {
  const activeUser = await db.meta.get('activeUserId');
  if (activeUser?.value === userId) return;

  await db.transaction(
    'rw',
    [
      db.workouts,
      db.sets,
      db.exercises,
      db.measurements,
      db.voiceEntries,
      db.outbox,
      db.conflicts,
      db.meta,
    ],
    async () => {
      await Promise.all([
        db.workouts.clear(),
        db.sets.clear(),
        db.exercises.clear(),
        db.measurements.clear(),
        db.voiceEntries.clear(),
        db.outbox.clear(),
        db.conflicts.clear(),
        db.meta.clear(),
      ]);
      await db.meta.put({ key: 'activeUserId', value: userId });
    },
  );
}

export async function cacheCurrentUser(user: CurrentUser) {
  const activeUser = await db.meta.get('activeUserId');
  if (activeUser?.value !== user.id) return;
  await db.meta.bulkPut([
    { key: 'cachedCurrentUser', value: JSON.stringify(user) },
    { key: 'offlineSessionAllowed', value: 'true' },
  ]);
}

export async function getCachedCurrentUser(): Promise<CurrentUser | null> {
  const [activeUser, cachedUser, offlineAllowed] = await db.meta.bulkGet([
    'activeUserId',
    'cachedCurrentUser',
    'offlineSessionAllowed',
  ]);
  if (!activeUser || !cachedUser || offlineAllowed?.value !== 'true') return null;
  try {
    const parsed = parseCurrentUser(JSON.parse(cachedUser.value));
    return parsed?.id === activeUser.value ? parsed : null;
  } catch {
    return null;
  }
}

export async function disableOfflineSession() {
  await db.meta.put({ key: 'offlineSessionAllowed', value: 'false' });
}

export async function clearLocalUserData() {
  await db.transaction(
    'rw',
    [
      db.workouts,
      db.sets,
      db.exercises,
      db.measurements,
      db.voiceEntries,
      db.outbox,
      db.conflicts,
      db.meta,
    ],
    async () => {
      await Promise.all([
        db.workouts.clear(),
        db.sets.clear(),
        db.exercises.clear(),
        db.measurements.clear(),
        db.voiceEntries.clear(),
        db.outbox.clear(),
        db.conflicts.clear(),
        db.meta.clear(),
      ]);
    },
  );
}
