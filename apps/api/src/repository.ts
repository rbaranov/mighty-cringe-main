import { randomUUID } from 'node:crypto';

import type {
  CreateSetInput,
  CreateWorkoutInput,
  CurrentUser,
  Exercise,
  SetRecord,
  UpdateSetInput,
  UpdateWorkoutInput,
  UserRole,
  WorkoutRecord,
} from '@mighty-cringe/contracts';
import {
  and,
  asc,
  authAttempts,
  clientMutations,
  createDatabase,
  desc,
  eq,
  exercises,
  gt,
  isNull,
  lt,
  sessions,
  sets,
  users,
  workouts,
} from '@mighty-cringe/db';

import { catalog } from './catalog.js';

export type GoogleIdentity = {
  subject: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
};

export type AuthAttempt = {
  stateHash: string;
  codeVerifier: string;
  nonce: string;
  returnTo: string;
  expiresAt: Date;
};

export type MutationResult =
  | { entityType: 'workout'; entity: WorkoutRecord; duplicate: boolean }
  | { entityType: 'set'; entity: SetRecord; duplicate: boolean };

export class RepositoryConflictError extends Error {
  constructor(readonly current: WorkoutRecord | SetRecord | null) {
    super('The record changed on another client');
  }
}

export class RepositoryNotFoundError extends Error {
  constructor() {
    super('Record not found');
  }
}

export interface WorkoutRepository {
  listExercises(): Promise<Exercise[]>;
  listWorkouts(userId: string): Promise<WorkoutRecord[]>;
  createWorkout(userId: string, input: CreateWorkoutInput): Promise<MutationResult>;
  updateWorkout(userId: string, input: UpdateWorkoutInput): Promise<MutationResult>;
  createSet(userId: string, input: CreateSetInput): Promise<MutationResult>;
  updateSet(userId: string, input: UpdateSetInput): Promise<MutationResult>;
  createAuthAttempt(attempt: AuthAttempt): Promise<void>;
  consumeAuthAttempt(stateHash: string, now: Date): Promise<AuthAttempt | null>;
  upsertGoogleUser(identity: GoogleIdentity, requestedRole: UserRole): Promise<CurrentUser>;
  createSession(input: {
    id: string;
    tokenHash: string;
    userId: string;
    expiresAt: Date;
  }): Promise<void>;
  getSessionUser(tokenHash: string, now: Date): Promise<CurrentUser | null>;
  revokeSession(tokenHash: string, now: Date): Promise<void>;
  listUsers(): Promise<CurrentUser[]>;
  close(): Promise<void>;
}

type MemoryWorkout = Omit<WorkoutRecord, 'sets'> & { userId: string };
type MemorySet = SetRecord & { userId: string };
type MemorySession = { tokenHash: string; userId: string; expiresAt: Date; revokedAt: Date | null };

export class MemoryRepository implements WorkoutRepository {
  private readonly workouts = new Map<string, MemoryWorkout>();
  private readonly sets = new Map<string, MemorySet>();
  private readonly mutations = new Set<string>();
  private readonly authAttempts = new Map<string, AuthAttempt>();
  private readonly users = new Map<string, CurrentUser & { googleSubject: string }>();
  private readonly sessions = new Map<string, MemorySession>();

  async listExercises() {
    return catalog;
  }

  async listWorkouts(userId: string) {
    return [...this.workouts.values()]
      .filter((workout) => workout.userId === userId)
      .sort((left, right) => right.startedAt.localeCompare(left.startedAt))
      .map((workout) => this.workoutRecord(workout));
  }

  async createWorkout(userId: string, input: CreateWorkoutInput): Promise<MutationResult> {
    const mutationKey = this.mutationKey(userId, input.clientMutationId);
    const existing = this.workouts.get(input.id);
    if (this.mutations.has(mutationKey)) {
      if (!existing || existing.userId !== userId) throw new RepositoryNotFoundError();
      return { entityType: 'workout', entity: this.workoutRecord(existing), duplicate: true };
    }
    if (existing) {
      if (existing.userId !== userId) throw new RepositoryConflictError(null);
      if (!sameWorkoutCreate(existing, input)) {
        throw new RepositoryConflictError(this.workoutRecord(existing));
      }
      this.mutations.add(mutationKey);
      return { entityType: 'workout', entity: this.workoutRecord(existing), duplicate: true };
    }

    const now = new Date().toISOString();
    const workout: MemoryWorkout = {
      id: input.id,
      userId,
      startedAt: input.startedAt,
      endedAt: input.endedAt,
      notes: input.notes,
      locale: input.locale,
      revision: 1,
      updatedAt: now,
    };
    this.workouts.set(input.id, workout);
    this.mutations.add(mutationKey);
    return { entityType: 'workout', entity: this.workoutRecord(workout), duplicate: false };
  }

  async updateWorkout(userId: string, input: UpdateWorkoutInput): Promise<MutationResult> {
    const mutationKey = this.mutationKey(userId, input.clientMutationId);
    const workout = this.workouts.get(input.workoutId);
    if (!workout || workout.userId !== userId) throw new RepositoryNotFoundError();
    if (this.mutations.has(mutationKey)) {
      return { entityType: 'workout', entity: this.workoutRecord(workout), duplicate: true };
    }
    if (workoutChangesMatch(workout, input.changes)) {
      this.mutations.add(mutationKey);
      return { entityType: 'workout', entity: this.workoutRecord(workout), duplicate: true };
    }
    if (workout.revision !== input.baseRevision) {
      throw new RepositoryConflictError(this.workoutRecord(workout));
    }

    if (input.changes.startedAt !== undefined) workout.startedAt = input.changes.startedAt;
    if ('endedAt' in input.changes) workout.endedAt = input.changes.endedAt ?? null;
    if ('notes' in input.changes) workout.notes = input.changes.notes ?? null;
    workout.revision += 1;
    workout.updatedAt = new Date().toISOString();
    this.mutations.add(mutationKey);
    return { entityType: 'workout', entity: this.workoutRecord(workout), duplicate: false };
  }

  async createSet(userId: string, input: CreateSetInput): Promise<MutationResult> {
    const mutationKey = this.mutationKey(userId, input.clientMutationId);
    const existing = this.sets.get(input.set.id);
    if (this.mutations.has(mutationKey)) {
      if (!existing || existing.userId !== userId) throw new RepositoryNotFoundError();
      return { entityType: 'set', entity: toPublicSet(existing), duplicate: true };
    }
    const workout = this.workouts.get(input.workoutId);
    if (!workout || workout.userId !== userId) throw new RepositoryNotFoundError();
    if (existing) {
      if (existing.userId !== userId) throw new RepositoryConflictError(null);
      if (!sameSetCreate(existing, input)) {
        throw new RepositoryConflictError(toPublicSet(existing));
      }
      this.mutations.add(mutationKey);
      return { entityType: 'set', entity: toPublicSet(existing), duplicate: true };
    }

    const set: MemorySet = {
      ...input.set,
      workoutId: input.workoutId,
      userId,
      revision: 1,
      updatedAt: new Date().toISOString(),
    };
    this.sets.set(set.id, set);
    this.mutations.add(mutationKey);
    return { entityType: 'set', entity: toPublicSet(set), duplicate: false };
  }

  async updateSet(userId: string, input: UpdateSetInput): Promise<MutationResult> {
    const mutationKey = this.mutationKey(userId, input.clientMutationId);
    const set = this.sets.get(input.setId);
    if (!set || set.userId !== userId || set.workoutId !== input.workoutId) {
      throw new RepositoryNotFoundError();
    }
    if (this.mutations.has(mutationKey)) {
      return { entityType: 'set', entity: toPublicSet(set), duplicate: true };
    }
    if (setChangesMatch(set, input.changes)) {
      this.mutations.add(mutationKey);
      return { entityType: 'set', entity: toPublicSet(set), duplicate: true };
    }
    if (set.revision !== input.baseRevision) {
      throw new RepositoryConflictError(toPublicSet(set));
    }

    if (input.changes.weightKg !== undefined) set.weightKg = input.changes.weightKg;
    if (input.changes.reps !== undefined) set.reps = input.changes.reps;
    if ('rir' in input.changes) set.rir = input.changes.rir ?? null;
    if ('comment' in input.changes) set.comment = input.changes.comment ?? null;
    if (input.changes.performedAt !== undefined) set.performedAt = input.changes.performedAt;
    set.revision += 1;
    set.updatedAt = new Date().toISOString();
    this.mutations.add(mutationKey);
    return { entityType: 'set', entity: toPublicSet(set), duplicate: false };
  }

  async createAuthAttempt(attempt: AuthAttempt) {
    this.authAttempts.set(attempt.stateHash, attempt);
  }

  async consumeAuthAttempt(stateHash: string, now: Date) {
    const attempt = this.authAttempts.get(stateHash) ?? null;
    this.authAttempts.delete(stateHash);
    if (!attempt || attempt.expiresAt <= now) return null;
    return attempt;
  }

  async upsertGoogleUser(identity: GoogleIdentity, requestedRole: UserRole) {
    const normalizedEmail = identity.email.trim().toLowerCase();
    const existing = [...this.users.values()].find(
      (user) => user.googleSubject === identity.subject || user.email === normalizedEmail,
    );
    if (existing?.googleSubject && existing.googleSubject !== identity.subject) {
      throw new Error('Email is already linked to another Google account');
    }

    const user: CurrentUser & { googleSubject: string } = {
      id: existing?.id ?? randomUUID(),
      googleSubject: identity.subject,
      email: normalizedEmail,
      displayName: identity.displayName,
      avatarUrl: identity.avatarUrl,
      role: resolvedRole(existing?.role, requestedRole),
      locale: existing?.locale ?? 'ru',
    };
    this.users.set(user.id, user);
    return toCurrentUser(user);
  }

  async createSession(input: { id: string; tokenHash: string; userId: string; expiresAt: Date }) {
    this.sessions.set(input.tokenHash, { ...input, revokedAt: null });
  }

  async getSessionUser(tokenHash: string, now: Date) {
    const session = this.sessions.get(tokenHash);
    if (!session || session.revokedAt || session.expiresAt <= now) return null;
    const user = this.users.get(session.userId);
    return user ? toCurrentUser(user) : null;
  }

  async revokeSession(tokenHash: string, now: Date) {
    const session = this.sessions.get(tokenHash);
    if (session) session.revokedAt = now;
  }

  async listUsers() {
    return [...this.users.values()]
      .map(toCurrentUser)
      .sort((left, right) => left.email.localeCompare(right.email));
  }

  async close() {}

  private mutationKey(userId: string, mutationId: string) {
    return `${userId}:${mutationId}`;
  }

  private workoutRecord(workout: MemoryWorkout): WorkoutRecord {
    return {
      id: workout.id,
      startedAt: workout.startedAt,
      endedAt: workout.endedAt,
      notes: workout.notes,
      locale: workout.locale,
      revision: workout.revision,
      updatedAt: workout.updatedAt,
      sets: [...this.sets.values()]
        .filter((set) => set.userId === workout.userId && set.workoutId === workout.id)
        .sort((left, right) => left.performedAt.localeCompare(right.performedAt))
        .map(toPublicSet),
    };
  }
}

export class PostgresRepository implements WorkoutRepository {
  private readonly db;

  constructor(connectionString: string) {
    this.db = createDatabase(connectionString);
  }

  async initialize() {
    for (const exercise of catalog) {
      await this.db
        .insert(exercises)
        .values({
          ...exercise,
          scope: 'global',
          ownerId: null,
          videos: [],
          notes: null,
        })
        .onConflictDoNothing({ target: exercises.id });
    }
  }

  async listExercises(): Promise<Exercise[]> {
    const records = await this.db.select().from(exercises).where(eq(exercises.scope, 'global'));
    return records.map((record) => ({
      id: record.id,
      nameRu: record.nameRu,
      nameEn: record.nameEn,
      aliases: record.aliases,
      tag: record.tag,
      primaryMuscles: record.primaryMuscles as Exercise['primaryMuscles'],
      secondaryMuscles: record.secondaryMuscles as Exercise['secondaryMuscles'],
      equipment: record.equipment,
    }));
  }

  async listWorkouts(userId: string): Promise<WorkoutRecord[]> {
    const workoutRows = await this.db
      .select()
      .from(workouts)
      .where(and(eq(workouts.userId, userId), isNull(workouts.deletedAt)))
      .orderBy(desc(workouts.startedAt));
    const setRows = await this.db
      .select({ set: sets })
      .from(sets)
      .innerJoin(workouts, eq(sets.workoutId, workouts.id))
      .where(and(eq(workouts.userId, userId), isNull(workouts.deletedAt)))
      .orderBy(asc(sets.performedAt));

    return workoutRows.map((workout) =>
      toWorkoutRecord(
        workout,
        setRows
          .filter((row) => row.set.workoutId === workout.id)
          .map((row) => toSetRecord(row.set)),
      ),
    );
  }

  async createWorkout(userId: string, input: CreateWorkoutInput): Promise<MutationResult> {
    const duplicate = await this.db.transaction(async (transaction) => {
      const alreadyApplied = await recordMutation(transaction, userId, input.clientMutationId);
      if (alreadyApplied) return true;

      const existingRows = await transaction
        .select()
        .from(workouts)
        .where(eq(workouts.id, input.id))
        .limit(1);
      const existing = existingRows[0];
      if (existing) {
        if (existing.userId !== userId) throw new RepositoryConflictError(null);
        if (!sameWorkoutCreate(existing, input)) {
          throw new RepositoryConflictError(toWorkoutRecord(existing, []));
        }
        return true;
      }

      await transaction.insert(workouts).values({
        id: input.id,
        userId,
        startedAt: new Date(input.startedAt),
        endedAt: input.endedAt ? new Date(input.endedAt) : null,
        notes: input.notes,
        locale: input.locale,
      });
      return false;
    });
    const entity = await this.getWorkout(userId, input.id);
    if (!entity) throw new RepositoryNotFoundError();
    return { entityType: 'workout', entity, duplicate };
  }

  async updateWorkout(userId: string, input: UpdateWorkoutInput): Promise<MutationResult> {
    const duplicate = await this.db.transaction(async (transaction) => {
      const alreadyApplied = await recordMutation(transaction, userId, input.clientMutationId);
      if (alreadyApplied) return true;

      const existingRows = await transaction
        .select()
        .from(workouts)
        .where(and(eq(workouts.id, input.workoutId), eq(workouts.userId, userId)))
        .limit(1);
      const existing = existingRows[0];
      if (!existing) throw new RepositoryNotFoundError();
      if (workoutChangesMatch(existing, input.changes)) return true;
      if (existing.revision !== input.baseRevision) {
        throw new RepositoryConflictError(toWorkoutRecord(existing, []));
      }

      const updated = await transaction
        .update(workouts)
        .set({
          startedAt:
            input.changes.startedAt === undefined
              ? existing.startedAt
              : new Date(input.changes.startedAt),
          endedAt:
            'endedAt' in input.changes
              ? input.changes.endedAt
                ? new Date(input.changes.endedAt)
                : null
              : existing.endedAt,
          notes: 'notes' in input.changes ? (input.changes.notes ?? null) : existing.notes,
          revision: existing.revision + 1,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(workouts.id, existing.id),
            eq(workouts.userId, userId),
            eq(workouts.revision, input.baseRevision),
          ),
        )
        .returning();
      if (!updated.length) {
        const currentRows = await transaction
          .select()
          .from(workouts)
          .where(and(eq(workouts.id, input.workoutId), eq(workouts.userId, userId)))
          .limit(1);
        const current = currentRows[0];
        if (!current) throw new RepositoryNotFoundError();
        if (workoutChangesMatch(current, input.changes)) return true;
        throw new RepositoryConflictError(toWorkoutRecord(current, []));
      }
      return false;
    });
    const entity = await this.getWorkout(userId, input.workoutId);
    if (!entity) throw new RepositoryNotFoundError();
    return { entityType: 'workout', entity, duplicate };
  }

  async createSet(userId: string, input: CreateSetInput): Promise<MutationResult> {
    const duplicate = await this.db.transaction(async (transaction) => {
      const alreadyApplied = await recordMutation(transaction, userId, input.clientMutationId);
      if (alreadyApplied) return true;

      const workoutRows = await transaction
        .select({ id: workouts.id })
        .from(workouts)
        .where(and(eq(workouts.id, input.workoutId), eq(workouts.userId, userId)))
        .limit(1);
      if (!workoutRows.length) throw new RepositoryNotFoundError();

      const existingRows = await transaction
        .select({ set: sets, userId: workouts.userId })
        .from(sets)
        .innerJoin(workouts, eq(sets.workoutId, workouts.id))
        .where(eq(sets.id, input.set.id))
        .limit(1);
      const existing = existingRows[0];
      if (existing) {
        if (existing.userId !== userId) throw new RepositoryConflictError(null);
        if (!sameSetCreate(existing.set, input)) {
          throw new RepositoryConflictError(toSetRecord(existing.set));
        }
        return true;
      }

      await transaction.insert(sets).values({
        id: input.set.id,
        workoutId: input.workoutId,
        exerciseId: input.set.exerciseId,
        weightKg: input.set.weightKg.toFixed(2),
        reps: input.set.reps,
        rir: input.set.rir,
        comment: input.set.comment,
        performedAt: new Date(input.set.performedAt),
      });
      return false;
    });
    const entity = await this.getSet(userId, input.set.id);
    if (!entity) throw new RepositoryNotFoundError();
    return { entityType: 'set', entity, duplicate };
  }

  async updateSet(userId: string, input: UpdateSetInput): Promise<MutationResult> {
    const duplicate = await this.db.transaction(async (transaction) => {
      const alreadyApplied = await recordMutation(transaction, userId, input.clientMutationId);
      if (alreadyApplied) return true;

      const existingRows = await transaction
        .select({ set: sets })
        .from(sets)
        .innerJoin(workouts, eq(sets.workoutId, workouts.id))
        .where(
          and(
            eq(sets.id, input.setId),
            eq(sets.workoutId, input.workoutId),
            eq(workouts.userId, userId),
          ),
        )
        .limit(1);
      const existing = existingRows[0]?.set;
      if (!existing) throw new RepositoryNotFoundError();
      if (setChangesMatch(existing, input.changes)) return true;
      if (existing.revision !== input.baseRevision) {
        throw new RepositoryConflictError(toSetRecord(existing));
      }

      const updated = await transaction
        .update(sets)
        .set({
          weightKg:
            input.changes.weightKg === undefined
              ? existing.weightKg
              : input.changes.weightKg.toFixed(2),
          reps: input.changes.reps ?? existing.reps,
          rir: 'rir' in input.changes ? (input.changes.rir ?? null) : existing.rir,
          comment: 'comment' in input.changes ? (input.changes.comment ?? null) : existing.comment,
          performedAt:
            input.changes.performedAt === undefined
              ? existing.performedAt
              : new Date(input.changes.performedAt),
          revision: existing.revision + 1,
          updatedAt: new Date(),
        })
        .where(and(eq(sets.id, existing.id), eq(sets.revision, input.baseRevision)))
        .returning();
      if (!updated.length) {
        const currentRows = await transaction
          .select({ set: sets })
          .from(sets)
          .innerJoin(workouts, eq(sets.workoutId, workouts.id))
          .where(and(eq(sets.id, input.setId), eq(workouts.userId, userId)))
          .limit(1);
        const current = currentRows[0]?.set;
        if (!current) throw new RepositoryNotFoundError();
        if (setChangesMatch(current, input.changes)) return true;
        throw new RepositoryConflictError(toSetRecord(current));
      }
      return false;
    });
    const entity = await this.getSet(userId, input.setId);
    if (!entity) throw new RepositoryNotFoundError();
    return { entityType: 'set', entity, duplicate };
  }

  async createAuthAttempt(attempt: AuthAttempt) {
    await this.db.delete(authAttempts).where(lt(authAttempts.expiresAt, new Date()));
    await this.db.insert(authAttempts).values(attempt);
  }

  async consumeAuthAttempt(stateHash: string, now: Date) {
    return this.db.transaction(async (transaction) => {
      const records = await transaction
        .select()
        .from(authAttempts)
        .where(eq(authAttempts.stateHash, stateHash))
        .limit(1);
      await transaction.delete(authAttempts).where(eq(authAttempts.stateHash, stateHash));
      const attempt = records[0];
      if (!attempt || attempt.expiresAt <= now) return null;
      return attempt;
    });
  }

  async upsertGoogleUser(identity: GoogleIdentity, requestedRole: UserRole) {
    const normalizedEmail = identity.email.trim().toLowerCase();
    const bySubject = await this.db
      .select()
      .from(users)
      .where(eq(users.googleSubject, identity.subject))
      .limit(1);
    const byEmail = bySubject.length
      ? []
      : await this.db.select().from(users).where(eq(users.email, normalizedEmail)).limit(1);
    const existing = bySubject[0] ?? byEmail[0];

    if (existing?.googleSubject && existing.googleSubject !== identity.subject) {
      throw new Error('Email is already linked to another Google account');
    }

    if (existing) {
      const updated = await this.db
        .update(users)
        .set({
          googleSubject: identity.subject,
          email: normalizedEmail,
          displayName: identity.displayName,
          avatarUrl: identity.avatarUrl,
          role: resolvedRole(existing.role, requestedRole),
          updatedAt: new Date(),
        })
        .where(eq(users.id, existing.id))
        .returning();
      return toCurrentUser(updated[0]);
    }

    const created = await this.db
      .insert(users)
      .values({
        id: randomUUID(),
        googleSubject: identity.subject,
        email: normalizedEmail,
        displayName: identity.displayName,
        avatarUrl: identity.avatarUrl,
        role: requestedRole === 'admin' ? 'admin' : 'athlete',
      })
      .returning();
    return toCurrentUser(created[0]);
  }

  async createSession(input: { id: string; tokenHash: string; userId: string; expiresAt: Date }) {
    await this.db.delete(sessions).where(lt(sessions.expiresAt, new Date()));
    await this.db.insert(sessions).values(input);
  }

  async getSessionUser(tokenHash: string, now: Date) {
    const records = await this.db
      .select({
        id: users.id,
        email: users.email,
        displayName: users.displayName,
        avatarUrl: users.avatarUrl,
        role: users.role,
        locale: users.locale,
      })
      .from(sessions)
      .innerJoin(users, eq(sessions.userId, users.id))
      .where(
        and(
          eq(sessions.tokenHash, tokenHash),
          gt(sessions.expiresAt, now),
          isNull(sessions.revokedAt),
        ),
      )
      .limit(1);
    return records[0] ? toCurrentUser(records[0]) : null;
  }

  async revokeSession(tokenHash: string, now: Date) {
    await this.db
      .update(sessions)
      .set({ revokedAt: now })
      .where(and(eq(sessions.tokenHash, tokenHash), isNull(sessions.revokedAt)));
  }

  async listUsers() {
    const records = await this.db
      .select({
        id: users.id,
        email: users.email,
        displayName: users.displayName,
        avatarUrl: users.avatarUrl,
        role: users.role,
        locale: users.locale,
      })
      .from(users)
      .orderBy(asc(users.email));
    return records.map(toCurrentUser);
  }

  async close() {
    await this.db.$client.end();
  }

  private async getWorkout(userId: string, workoutId: string) {
    const all = await this.listWorkouts(userId);
    return all.find((workout) => workout.id === workoutId) ?? null;
  }

  private async getSet(userId: string, setId: string) {
    const rows = await this.db
      .select({ set: sets })
      .from(sets)
      .innerJoin(workouts, eq(sets.workoutId, workouts.id))
      .where(and(eq(sets.id, setId), eq(workouts.userId, userId)))
      .limit(1);
    return rows[0] ? toSetRecord(rows[0].set) : null;
  }
}

type Database = ReturnType<typeof createDatabase>;
type MutationTransaction = Parameters<Parameters<Database['transaction']>[0]>[0];

async function recordMutation(
  transaction: MutationTransaction,
  userId: string,
  mutationId: string,
) {
  const inserted = await transaction
    .insert(clientMutations)
    .values({ id: mutationId, userId })
    .onConflictDoNothing()
    .returning({ id: clientMutations.id });
  return inserted.length === 0;
}

function toWorkoutRecord(
  workout: typeof workouts.$inferSelect,
  workoutSets: SetRecord[],
): WorkoutRecord {
  return {
    id: workout.id,
    startedAt: workout.startedAt.toISOString(),
    endedAt: workout.endedAt?.toISOString() ?? null,
    notes: workout.notes,
    locale: workout.locale === 'en' ? 'en' : 'ru',
    revision: workout.revision,
    updatedAt: workout.updatedAt.toISOString(),
    sets: workoutSets,
  };
}

function toSetRecord(set: typeof sets.$inferSelect): SetRecord {
  return {
    id: set.id,
    workoutId: set.workoutId,
    exerciseId: set.exerciseId,
    weightKg: Number(set.weightKg),
    reps: set.reps,
    rir: set.rir,
    comment: set.comment,
    performedAt: set.performedAt.toISOString(),
    revision: set.revision,
    updatedAt: set.updatedAt.toISOString(),
  };
}

function toPublicSet(set: MemorySet): SetRecord {
  const { userId: _userId, ...record } = set;
  return record;
}

function sameWorkoutCreate(
  workout: MemoryWorkout | typeof workouts.$inferSelect,
  input: CreateWorkoutInput,
) {
  return (
    asIso(workout.startedAt) === input.startedAt &&
    asNullableIso(workout.endedAt) === input.endedAt &&
    workout.notes === input.notes &&
    workout.locale === input.locale
  );
}

function sameSetCreate(set: MemorySet | typeof sets.$inferSelect, input: CreateSetInput) {
  return (
    set.workoutId === input.workoutId &&
    set.exerciseId === input.set.exerciseId &&
    Number(set.weightKg) === input.set.weightKg &&
    set.reps === input.set.reps &&
    set.rir === input.set.rir &&
    set.comment === input.set.comment &&
    asIso(set.performedAt) === input.set.performedAt
  );
}

function workoutChangesMatch(
  workout: MemoryWorkout | typeof workouts.$inferSelect,
  changes: UpdateWorkoutInput['changes'],
) {
  return (
    (changes.startedAt === undefined || asIso(workout.startedAt) === changes.startedAt) &&
    (!('endedAt' in changes) || asNullableIso(workout.endedAt) === (changes.endedAt ?? null)) &&
    (!('notes' in changes) || workout.notes === (changes.notes ?? null))
  );
}

function setChangesMatch(
  set: MemorySet | typeof sets.$inferSelect,
  changes: UpdateSetInput['changes'],
) {
  return (
    (changes.weightKg === undefined || Number(set.weightKg) === changes.weightKg) &&
    (changes.reps === undefined || set.reps === changes.reps) &&
    (!('rir' in changes) || set.rir === (changes.rir ?? null)) &&
    (!('comment' in changes) || set.comment === (changes.comment ?? null)) &&
    (changes.performedAt === undefined || asIso(set.performedAt) === changes.performedAt)
  );
}

function asIso(value: string | Date) {
  return typeof value === 'string' ? value : value.toISOString();
}

function asNullableIso(value: string | Date | null) {
  return value === null ? null : asIso(value);
}

function toCurrentUser(user: {
  id: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  role: UserRole;
  locale: string;
}): CurrentUser {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    role: user.role,
    locale: user.locale === 'en' ? 'en' : 'ru',
  };
}

function resolvedRole(existingRole: UserRole | undefined, requestedRole: UserRole): UserRole {
  if (existingRole === 'trainer' || existingRole === 'superadmin') return existingRole;
  return requestedRole === 'admin' ? 'admin' : 'athlete';
}
