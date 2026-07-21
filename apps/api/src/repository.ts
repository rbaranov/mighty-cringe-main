import { randomUUID } from 'node:crypto';

import type {
  CreateSetInput,
  CreateWorkoutInput,
  CurrentUser,
  Exercise,
  UserRole,
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

export type WorkoutSummary = {
  id: string;
  startedAt: string;
  endedAt: string | null;
  setCount: number;
};

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

export interface WorkoutRepository {
  listExercises(): Promise<Exercise[]>;
  listWorkouts(userId: string): Promise<WorkoutSummary[]>;
  createWorkout(
    userId: string,
    input: CreateWorkoutInput,
  ): Promise<{ id: string; duplicate: boolean }>;
  createSet(userId: string, input: CreateSetInput): Promise<{ id: string; duplicate: boolean }>;
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
}

type MemoryWorkout = WorkoutSummary & { userId: string };
type MemorySession = { tokenHash: string; userId: string; expiresAt: Date; revokedAt: Date | null };

export class MemoryRepository implements WorkoutRepository {
  private readonly workouts = new Map<string, MemoryWorkout>();
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
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }

  async createWorkout(userId: string, input: CreateWorkoutInput) {
    const mutationKey = `${userId}:${input.clientMutationId}`;
    if (this.mutations.has(mutationKey)) return { id: input.id, duplicate: true };

    this.mutations.add(mutationKey);
    this.workouts.set(input.id, {
      id: input.id,
      userId,
      startedAt: input.startedAt,
      endedAt: null,
      setCount: 0,
    });
    return { id: input.id, duplicate: false };
  }

  async createSet(userId: string, input: CreateSetInput) {
    const mutationKey = `${userId}:${input.clientMutationId}`;
    if (this.mutations.has(mutationKey)) return { id: input.set.id, duplicate: true };
    const workout = this.workouts.get(input.workoutId);
    if (!workout || workout.userId !== userId) throw new Error('Workout not found');

    this.mutations.add(mutationKey);
    workout.setCount += 1;
    return { id: input.set.id, duplicate: false };
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

  async createSession(input: { tokenHash: string; userId: string; expiresAt: Date }) {
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

  async listWorkouts(userId: string): Promise<WorkoutSummary[]> {
    const records = await this.db
      .select()
      .from(workouts)
      .where(and(eq(workouts.userId, userId), isNull(workouts.deletedAt)))
      .orderBy(desc(workouts.startedAt));

    return records.map((workout) => ({
      id: workout.id,
      startedAt: workout.startedAt.toISOString(),
      endedAt: workout.endedAt?.toISOString() ?? null,
      setCount: 0,
    }));
  }

  async createWorkout(userId: string, input: CreateWorkoutInput) {
    const duplicate = await this.hasMutation(userId, input.clientMutationId);
    if (duplicate) return { id: input.id, duplicate: true };

    await this.db.transaction(async (transaction) => {
      await transaction.insert(workouts).values({
        id: input.id,
        userId,
        startedAt: new Date(input.startedAt),
      });
      await transaction.insert(clientMutations).values({ id: input.clientMutationId, userId });
    });
    return { id: input.id, duplicate: false };
  }

  async createSet(userId: string, input: CreateSetInput) {
    const duplicate = await this.hasMutation(userId, input.clientMutationId);
    if (duplicate) return { id: input.set.id, duplicate: true };

    const workout = await this.db
      .select({ id: workouts.id })
      .from(workouts)
      .where(and(eq(workouts.id, input.workoutId), eq(workouts.userId, userId)))
      .limit(1);
    if (!workout.length) throw new Error('Workout not found');

    await this.db.transaction(async (transaction) => {
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
      await transaction.insert(clientMutations).values({ id: input.clientMutationId, userId });
    });
    return { id: input.set.id, duplicate: false };
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

  private async hasMutation(userId: string, mutationId: string) {
    const result = await this.db
      .select({ id: clientMutations.id })
      .from(clientMutations)
      .where(and(eq(clientMutations.userId, userId), eq(clientMutations.id, mutationId)))
      .limit(1);
    return result.length > 0;
  }
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
