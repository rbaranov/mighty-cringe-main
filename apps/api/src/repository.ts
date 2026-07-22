import { randomUUID } from 'node:crypto';

import type {
  CreateExerciseInput,
  CreateMeasurementInput,
  CreateSetInput,
  CreateWorkoutInput,
  CurrentUser,
  DeleteMeasurementInput,
  DeleteSetInput,
  Exercise,
  MeasurementRecord,
  MeasurementValues,
  NotificationPreferences,
  PushSubscriptionInput,
  SetRecord,
  TrainerAthleteSummary,
  TrainerInviteRecord,
  TrainerSummary,
  UpdateMeasurementInput,
  UpdateNotificationPreferences,
  UpdateSetInput,
  UpdateUserPreferences,
  UpdateWorkoutInput,
  UserRole,
  VoiceEntryRecord,
  WorkoutExercise,
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
  measurementEntries,
  notificationPreferences,
  notificationJobs,
  pushSubscriptions,
  or,
  sessions,
  sets,
  trainerAthleteLinks,
  trainerInvites,
  users,
  voiceEntries,
  workoutExercises,
  workouts,
} from '@mighty-cringe/db';
import type { AudioFormat } from '@mighty-cringe/voice';

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

export type VoiceEntryCreateInput = {
  id: string;
  workoutId: string | null;
  objectKey: string;
  mimeType: string;
  audioFormat: AudioFormat;
  sizeBytes: number;
  consentVersion: string;
};

export type TrainerInviteCreateInput = {
  id: string;
  trainerId: string;
  email: string | null;
  tokenHash: string;
  expiresAt: Date;
};

export type WorkoutMutationResult = {
  entityType: 'workout';
  entity: WorkoutRecord;
  duplicate: boolean;
};

export type SetMutationResult = {
  entityType: 'set';
  entity: SetRecord;
  duplicate: boolean;
};

export type MeasurementMutationResult = {
  entityType: 'measurement';
  entity: MeasurementRecord;
  duplicate: boolean;
};

export type EntityMutationResult =
  WorkoutMutationResult | SetMutationResult | MeasurementMutationResult;

export type DeleteMutationResult = {
  entityType: 'set' | 'measurement';
  entity: null;
  entityId: string;
  duplicate: boolean;
};

export type MutationResult = EntityMutationResult | DeleteMutationResult;

export class RepositoryConflictError extends Error {
  constructor(readonly current: WorkoutRecord | SetRecord | MeasurementRecord | null) {
    super('The record changed on another client');
  }
}

export class RepositoryNotFoundError extends Error {
  constructor() {
    super('Record not found');
  }
}

export class RepositoryInviteError extends Error {
  constructor(
    readonly code: 'invite_expired' | 'invite_used' | 'invite_email_mismatch' | 'self_link',
    message: string,
  ) {
    super(message);
  }
}

export interface WorkoutRepository {
  listExercises(userId: string): Promise<Exercise[]>;
  createExercise(userId: string, input: CreateExerciseInput): Promise<Exercise>;
  listWorkouts(userId: string): Promise<WorkoutRecord[]>;
  createWorkout(userId: string, input: CreateWorkoutInput): Promise<WorkoutMutationResult>;
  updateWorkout(userId: string, input: UpdateWorkoutInput): Promise<WorkoutMutationResult>;
  createSet(userId: string, input: CreateSetInput): Promise<SetMutationResult>;
  updateSet(userId: string, input: UpdateSetInput): Promise<SetMutationResult>;
  deleteSet(userId: string, input: DeleteSetInput): Promise<DeleteMutationResult>;
  listMeasurements(userId: string): Promise<MeasurementRecord[]>;
  createMeasurement(
    userId: string,
    input: CreateMeasurementInput,
  ): Promise<MeasurementMutationResult>;
  updateMeasurement(
    userId: string,
    input: UpdateMeasurementInput,
  ): Promise<MeasurementMutationResult>;
  deleteMeasurement(userId: string, input: DeleteMeasurementInput): Promise<DeleteMutationResult>;
  listVoiceEntries(userId: string): Promise<VoiceEntryRecord[]>;
  createVoiceEntry(userId: string, input: VoiceEntryCreateInput): Promise<VoiceEntryRecord>;
  getVoiceObject(
    userId: string,
    voiceEntryId: string,
  ): Promise<{ objectKey: string; mimeType: string } | null>;
  deleteVoiceEntry(userId: string, voiceEntryId: string): Promise<boolean>;
  getNotificationPreferences(userId: string): Promise<NotificationPreferences>;
  updateNotificationPreferences(
    userId: string,
    input: UpdateNotificationPreferences,
    nextReminderAt: Date | null,
  ): Promise<NotificationPreferences>;
  upsertPushSubscription(userId: string, input: PushSubscriptionInput, now: Date): Promise<void>;
  deletePushSubscription(userId: string, endpoint: string): Promise<void>;
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
  updateUserPreferences(userId: string, input: UpdateUserPreferences): Promise<CurrentUser>;
  createTrainerInvite(input: TrainerInviteCreateInput, now: Date): Promise<TrainerInviteRecord>;
  listTrainerInvites(trainerId: string, now: Date): Promise<TrainerInviteRecord[]>;
  acceptTrainerInvite(
    tokenHash: string,
    athleteId: string,
    athleteEmail: string,
    now: Date,
  ): Promise<TrainerSummary>;
  getAthleteTrainer(athleteId: string): Promise<TrainerSummary | null>;
  listTrainerAthletes(trainerId: string): Promise<TrainerAthleteSummary[]>;
  listSharedWorkouts(trainerId: string, athleteId: string): Promise<WorkoutRecord[]>;
  listSharedMeasurements(trainerId: string, athleteId: string): Promise<MeasurementRecord[]>;
  revokeAthleteTrainer(athleteId: string, now: Date): Promise<boolean>;
  revokeTrainerAthlete(trainerId: string, athleteId: string, now: Date): Promise<boolean>;
  revokeTrainerInvite(trainerId: string, inviteId: string, now: Date): Promise<boolean>;
  close(): Promise<void>;
}

type MemoryWorkout = Omit<WorkoutRecord, 'sets'> & { userId: string };
type MemorySet = SetRecord & { userId: string };
type MemoryMeasurement = MeasurementRecord & { userId: string };
type MemoryVoiceEntry = VoiceEntryRecord &
  VoiceEntryCreateInput & {
    userId: string;
  };
type MemorySession = { tokenHash: string; userId: string; expiresAt: Date; revokedAt: Date | null };
type MemoryTrainerInvite = {
  id: string;
  trainerId: string;
  email: string | null;
  tokenHash: string;
  expiresAt: Date;
  acceptedByUserId: string | null;
  acceptedAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
};
type MemoryTrainerLink = {
  id: string;
  trainerId: string;
  athleteId: string;
  active: boolean;
  revokedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};
type MemoryPushSubscription = PushSubscriptionInput & { userId: string; updatedAt: Date };
type MemoryExercise = Exercise & { userId: string };

export class MemoryRepository implements WorkoutRepository {
  private readonly workouts = new Map<string, MemoryWorkout>();
  private readonly sets = new Map<string, MemorySet>();
  private readonly measurements = new Map<string, MemoryMeasurement>();
  private readonly voiceEntries = new Map<string, MemoryVoiceEntry>();
  private readonly mutations = new Set<string>();
  private readonly authAttempts = new Map<string, AuthAttempt>();
  private readonly users = new Map<string, CurrentUser & { googleSubject: string }>();
  private readonly sessions = new Map<string, MemorySession>();
  private readonly trainerInvites = new Map<string, MemoryTrainerInvite>();
  private readonly trainerLinks = new Map<string, MemoryTrainerLink>();
  private readonly notificationPreferences = new Map<string, NotificationPreferences>();
  private readonly pushSubscriptions = new Map<string, MemoryPushSubscription>();
  private readonly personalExercises = new Map<string, MemoryExercise>();

  async listExercises(userId: string) {
    return [
      ...catalog.map((exercise) => ({ ...exercise, scope: 'global' as const })),
      ...[...this.personalExercises.values()]
        .filter((exercise) => exercise.userId === userId)
        .map(({ userId: _userId, ...exercise }) => exercise),
    ];
  }

  async createExercise(userId: string, input: CreateExerciseInput): Promise<Exercise> {
    const existing = this.personalExercises.get(input.id);
    if (existing) {
      if (existing.userId !== userId) throw new RepositoryConflictError(null);
      const { userId: _userId, ...exercise } = existing;
      return exercise;
    }
    if (catalog.some((exercise) => exercise.id === input.id)) {
      throw new RepositoryConflictError(null);
    }
    const exercise: MemoryExercise = { ...input, scope: 'user', userId };
    this.personalExercises.set(input.id, exercise);
    const { userId: _userId, ...publicExercise } = exercise;
    return publicExercise;
  }

  async listWorkouts(userId: string) {
    return [...this.workouts.values()]
      .filter((workout) => workout.userId === userId)
      .sort((left, right) => right.startedAt.localeCompare(left.startedAt))
      .map((workout) => this.workoutRecord(workout));
  }

  async createWorkout(userId: string, input: CreateWorkoutInput): Promise<WorkoutMutationResult> {
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
      exercises: orderedPlan(input.exercises),
      revision: 1,
      updatedAt: now,
    };
    this.workouts.set(input.id, workout);
    this.mutations.add(mutationKey);
    return { entityType: 'workout', entity: this.workoutRecord(workout), duplicate: false };
  }

  async updateWorkout(userId: string, input: UpdateWorkoutInput): Promise<WorkoutMutationResult> {
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
    if (input.changes.exercises !== undefined) {
      workout.exercises = orderedPlan(input.changes.exercises);
    }
    workout.revision += 1;
    workout.updatedAt = new Date().toISOString();
    this.mutations.add(mutationKey);
    return { entityType: 'workout', entity: this.workoutRecord(workout), duplicate: false };
  }

  async createSet(userId: string, input: CreateSetInput): Promise<SetMutationResult> {
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

  async updateSet(userId: string, input: UpdateSetInput): Promise<SetMutationResult> {
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
    if (input.changes.position !== undefined) set.position = input.changes.position;
    set.revision += 1;
    set.updatedAt = new Date().toISOString();
    this.mutations.add(mutationKey);
    return { entityType: 'set', entity: toPublicSet(set), duplicate: false };
  }

  async deleteSet(userId: string, input: DeleteSetInput): Promise<DeleteMutationResult> {
    const mutationKey = this.mutationKey(userId, input.clientMutationId);
    if (this.mutations.has(mutationKey)) {
      return { entityType: 'set', entity: null, entityId: input.setId, duplicate: true };
    }

    const set = this.sets.get(input.setId);
    if (!set || set.userId !== userId || set.workoutId !== input.workoutId) {
      this.mutations.add(mutationKey);
      return { entityType: 'set', entity: null, entityId: input.setId, duplicate: true };
    }
    if (set.revision !== input.baseRevision) {
      throw new RepositoryConflictError(toPublicSet(set));
    }

    this.sets.delete(set.id);
    this.mutations.add(mutationKey);
    return { entityType: 'set', entity: null, entityId: input.setId, duplicate: false };
  }

  async listMeasurements(userId: string) {
    return [...this.measurements.values()]
      .filter((measurement) => measurement.userId === userId)
      .sort((left, right) => right.measuredOn.localeCompare(left.measuredOn))
      .map(toPublicMeasurement);
  }

  async createMeasurement(
    userId: string,
    input: CreateMeasurementInput,
  ): Promise<MeasurementMutationResult> {
    const mutationKey = this.mutationKey(userId, input.clientMutationId);
    const existing = this.measurements.get(input.id);
    if (this.mutations.has(mutationKey)) {
      if (!existing || existing.userId !== userId) throw new RepositoryNotFoundError();
      return { entityType: 'measurement', entity: toPublicMeasurement(existing), duplicate: true };
    }
    if (existing) {
      if (existing.userId !== userId) throw new RepositoryConflictError(null);
      if (!sameMeasurementCreate(existing, input)) {
        throw new RepositoryConflictError(toPublicMeasurement(existing));
      }
      this.mutations.add(mutationKey);
      return { entityType: 'measurement', entity: toPublicMeasurement(existing), duplicate: true };
    }

    const measurement: MemoryMeasurement = {
      id: input.id,
      userId,
      measuredOn: input.measuredOn,
      isSelfMeasured: input.isSelfMeasured,
      values: input.values,
      revision: 1,
      updatedAt: new Date().toISOString(),
    };
    this.measurements.set(measurement.id, measurement);
    this.mutations.add(mutationKey);
    return {
      entityType: 'measurement',
      entity: toPublicMeasurement(measurement),
      duplicate: false,
    };
  }

  async updateMeasurement(
    userId: string,
    input: UpdateMeasurementInput,
  ): Promise<MeasurementMutationResult> {
    const mutationKey = this.mutationKey(userId, input.clientMutationId);
    const measurement = this.measurements.get(input.measurementId);
    if (!measurement || measurement.userId !== userId) throw new RepositoryNotFoundError();
    if (this.mutations.has(mutationKey)) {
      return {
        entityType: 'measurement',
        entity: toPublicMeasurement(measurement),
        duplicate: true,
      };
    }
    if (measurementChangesMatch(measurement, input.changes)) {
      this.mutations.add(mutationKey);
      return {
        entityType: 'measurement',
        entity: toPublicMeasurement(measurement),
        duplicate: true,
      };
    }
    if (measurement.revision !== input.baseRevision) {
      throw new RepositoryConflictError(toPublicMeasurement(measurement));
    }

    if (input.changes.measuredOn !== undefined) measurement.measuredOn = input.changes.measuredOn;
    if (input.changes.isSelfMeasured !== undefined) {
      measurement.isSelfMeasured = input.changes.isSelfMeasured;
    }
    if (input.changes.values !== undefined) measurement.values = input.changes.values;
    measurement.revision += 1;
    measurement.updatedAt = new Date().toISOString();
    this.mutations.add(mutationKey);
    return {
      entityType: 'measurement',
      entity: toPublicMeasurement(measurement),
      duplicate: false,
    };
  }

  async deleteMeasurement(
    userId: string,
    input: DeleteMeasurementInput,
  ): Promise<DeleteMutationResult> {
    const mutationKey = this.mutationKey(userId, input.clientMutationId);
    if (this.mutations.has(mutationKey)) {
      return {
        entityType: 'measurement',
        entity: null,
        entityId: input.measurementId,
        duplicate: true,
      };
    }
    const measurement = this.measurements.get(input.measurementId);
    if (!measurement || measurement.userId !== userId) {
      this.mutations.add(mutationKey);
      return {
        entityType: 'measurement',
        entity: null,
        entityId: input.measurementId,
        duplicate: true,
      };
    }
    if (measurement.revision !== input.baseRevision) {
      throw new RepositoryConflictError(toPublicMeasurement(measurement));
    }

    this.measurements.delete(measurement.id);
    this.mutations.add(mutationKey);
    return {
      entityType: 'measurement',
      entity: null,
      entityId: input.measurementId,
      duplicate: false,
    };
  }

  async listVoiceEntries(userId: string) {
    return [...this.voiceEntries.values()]
      .filter((entry) => entry.userId === userId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .map(toPublicVoiceEntry);
  }

  async createVoiceEntry(userId: string, input: VoiceEntryCreateInput) {
    if (input.workoutId) {
      const workout = this.workouts.get(input.workoutId);
      if (!workout || workout.userId !== userId) throw new RepositoryNotFoundError();
    }
    const existing = this.voiceEntries.get(input.id);
    if (existing) {
      if (existing.userId !== userId) throw new RepositoryConflictError(null);
      return toPublicVoiceEntry(existing);
    }
    const now = new Date().toISOString();
    const entry: MemoryVoiceEntry = {
      ...input,
      userId,
      status: 'pending',
      transcript: null,
      createdAt: now,
      updatedAt: now,
      lastError: null,
    };
    this.voiceEntries.set(entry.id, entry);
    return toPublicVoiceEntry(entry);
  }

  async getVoiceObject(userId: string, voiceEntryId: string) {
    const entry = this.voiceEntries.get(voiceEntryId);
    return entry?.userId === userId
      ? { objectKey: entry.objectKey, mimeType: entry.mimeType }
      : null;
  }

  async deleteVoiceEntry(userId: string, voiceEntryId: string) {
    const entry = this.voiceEntries.get(voiceEntryId);
    if (!entry || entry.userId !== userId) return false;
    return this.voiceEntries.delete(voiceEntryId);
  }

  async getNotificationPreferences(userId: string) {
    return this.notificationPreferences.get(userId) ?? defaultNotificationPreferences();
  }

  async updateNotificationPreferences(
    userId: string,
    input: UpdateNotificationPreferences,
    nextReminderAt: Date | null,
  ) {
    const preferences: NotificationPreferences = {
      ...input,
      nextReminderAt: nextReminderAt?.toISOString() ?? null,
    };
    this.notificationPreferences.set(userId, preferences);
    if (!input.enabled) {
      for (const [endpoint, subscription] of this.pushSubscriptions) {
        if (subscription.userId === userId) this.pushSubscriptions.delete(endpoint);
      }
    }
    return preferences;
  }

  async upsertPushSubscription(userId: string, input: PushSubscriptionInput, now: Date) {
    this.pushSubscriptions.set(input.endpoint, { ...input, userId, updatedAt: now });
  }

  async deletePushSubscription(userId: string, endpoint: string) {
    const subscription = this.pushSubscriptions.get(endpoint);
    if (subscription?.userId === userId) this.pushSubscriptions.delete(endpoint);
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
      unitSystem: existing?.unitSystem ?? 'metric',
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

  async updateUserPreferences(userId: string, input: UpdateUserPreferences) {
    const user = this.users.get(userId);
    if (!user) throw new RepositoryNotFoundError();
    user.locale = input.locale;
    user.unitSystem = input.unitSystem;
    return toCurrentUser(user);
  }

  async createTrainerInvite(input: TrainerInviteCreateInput, now: Date) {
    const trainer = this.users.get(input.trainerId);
    if (!trainer || !canUseTrainerConsole(trainer.role)) throw new RepositoryNotFoundError();
    const invite: MemoryTrainerInvite = {
      ...input,
      acceptedByUserId: null,
      acceptedAt: null,
      revokedAt: null,
      createdAt: now,
    };
    this.trainerInvites.set(invite.id, invite);
    return toTrainerInviteRecord(invite, now);
  }

  async listTrainerInvites(trainerId: string, now: Date) {
    return [...this.trainerInvites.values()]
      .filter((invite) => invite.trainerId === trainerId)
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
      .map((invite) => toTrainerInviteRecord(invite, now));
  }

  async acceptTrainerInvite(tokenHash: string, athleteId: string, athleteEmail: string, now: Date) {
    const invite = [...this.trainerInvites.values()].find((item) => item.tokenHash === tokenHash);
    if (!invite || invite.revokedAt) throw new RepositoryNotFoundError();
    if (invite.acceptedAt)
      throw new RepositoryInviteError('invite_used', 'Invite was already used');
    if (invite.expiresAt <= now) {
      throw new RepositoryInviteError('invite_expired', 'Invite has expired');
    }
    if (invite.email && invite.email !== athleteEmail.trim().toLowerCase()) {
      throw new RepositoryInviteError(
        'invite_email_mismatch',
        'Invite belongs to another Google account',
      );
    }
    if (invite.trainerId === athleteId) {
      throw new RepositoryInviteError('self_link', 'A user cannot coach their own account');
    }
    const trainer = this.users.get(invite.trainerId);
    const athlete = this.users.get(athleteId);
    if (!trainer || !athlete || !canUseTrainerConsole(trainer.role)) {
      throw new RepositoryNotFoundError();
    }

    for (const link of this.trainerLinks.values()) {
      if (link.athleteId === athleteId && link.active) {
        link.active = false;
        link.revokedAt = now;
        link.updatedAt = now;
      }
    }
    const link: MemoryTrainerLink = {
      id: randomUUID(),
      trainerId: trainer.id,
      athleteId,
      active: true,
      revokedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    this.trainerLinks.set(link.id, link);
    invite.acceptedByUserId = athleteId;
    invite.acceptedAt = now;
    return toTrainerSummary(trainer);
  }

  async getAthleteTrainer(athleteId: string) {
    const link = [...this.trainerLinks.values()].find(
      (item) => item.athleteId === athleteId && item.active,
    );
    const trainer = link ? this.users.get(link.trainerId) : null;
    return trainer ? toTrainerSummary(trainer) : null;
  }

  async listTrainerAthletes(trainerId: string) {
    return [...this.trainerLinks.values()]
      .filter((link) => link.trainerId === trainerId && link.active)
      .flatMap((link) => {
        const athlete = this.users.get(link.athleteId);
        return athlete
          ? [
              {
                id: athlete.id,
                displayName: athlete.displayName,
                avatarUrl: athlete.avatarUrl,
                linkedAt: link.createdAt.toISOString(),
              },
            ]
          : [];
      })
      .sort((left, right) => left.displayName.localeCompare(right.displayName));
  }

  async listSharedWorkouts(trainerId: string, athleteId: string) {
    this.assertTrainerLink(trainerId, athleteId);
    return this.listWorkouts(athleteId);
  }

  async listSharedMeasurements(trainerId: string, athleteId: string) {
    this.assertTrainerLink(trainerId, athleteId);
    return this.listMeasurements(athleteId);
  }

  async revokeAthleteTrainer(athleteId: string, now: Date) {
    return this.revokeTrainerLink((link) => link.athleteId === athleteId, now);
  }

  async revokeTrainerAthlete(trainerId: string, athleteId: string, now: Date) {
    return this.revokeTrainerLink(
      (link) => link.trainerId === trainerId && link.athleteId === athleteId,
      now,
    );
  }

  async revokeTrainerInvite(trainerId: string, inviteId: string, now: Date) {
    const invite = this.trainerInvites.get(inviteId);
    if (!invite || invite.trainerId !== trainerId || invite.acceptedAt || invite.revokedAt) {
      return false;
    }
    invite.revokedAt = now;
    return true;
  }

  async close() {}

  private assertTrainerLink(trainerId: string, athleteId: string) {
    const linked = [...this.trainerLinks.values()].some(
      (link) => link.trainerId === trainerId && link.athleteId === athleteId && link.active,
    );
    if (!linked) throw new RepositoryNotFoundError();
  }

  private revokeTrainerLink(predicate: (link: MemoryTrainerLink) => boolean, now: Date) {
    const link = [...this.trainerLinks.values()].find((item) => item.active && predicate(item));
    if (!link) return false;
    link.active = false;
    link.revokedAt = now;
    link.updatedAt = now;
    return true;
  }

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
      exercises: orderedPlan(workout.exercises),
      revision: workout.revision,
      updatedAt: workout.updatedAt,
      sets: [...this.sets.values()]
        .filter((set) => set.userId === workout.userId && set.workoutId === workout.id)
        .sort(
          (left, right) =>
            left.position - right.position || left.performedAt.localeCompare(right.performedAt),
        )
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
          sources: [],
          notes: null,
        })
        .onConflictDoUpdate({
          target: exercises.id,
          set: {
            nameRu: exercise.nameRu,
            nameEn: exercise.nameEn,
            aliases: exercise.aliases,
            tag: exercise.tag,
            primaryMuscles: exercise.primaryMuscles,
            secondaryMuscles: exercise.secondaryMuscles,
            equipment: exercise.equipment,
            updatedAt: new Date(),
          },
        });
    }
  }

  async listExercises(userId: string): Promise<Exercise[]> {
    const records = await this.db
      .select()
      .from(exercises)
      .where(
        or(
          eq(exercises.scope, 'global'),
          and(eq(exercises.scope, 'user'), eq(exercises.ownerId, userId)),
        ),
      );
    return records.map(toExercise);
  }

  async createExercise(userId: string, input: CreateExerciseInput): Promise<Exercise> {
    const existing = await this.db
      .select()
      .from(exercises)
      .where(eq(exercises.id, input.id))
      .limit(1);
    if (existing[0]) {
      if (existing[0].scope !== 'user' || existing[0].ownerId !== userId) {
        throw new RepositoryConflictError(null);
      }
      return toExercise(existing[0]);
    }
    const records = await this.db
      .insert(exercises)
      .values({ ...input, scope: 'user', ownerId: userId })
      .returning();
    return toExercise(records[0]);
  }

  async listWorkouts(userId: string): Promise<WorkoutRecord[]> {
    const workoutRows = await this.db
      .select()
      .from(workouts)
      .where(and(eq(workouts.userId, userId), isNull(workouts.deletedAt)))
      .orderBy(desc(workouts.startedAt));
    const planRows = await this.db
      .select({ item: workoutExercises })
      .from(workoutExercises)
      .innerJoin(workouts, eq(workoutExercises.workoutId, workouts.id))
      .where(and(eq(workouts.userId, userId), isNull(workouts.deletedAt)))
      .orderBy(asc(workoutExercises.position));
    const setRows = await this.db
      .select({ set: sets })
      .from(sets)
      .innerJoin(workouts, eq(sets.workoutId, workouts.id))
      .where(and(eq(workouts.userId, userId), isNull(workouts.deletedAt)))
      .orderBy(asc(sets.position), asc(sets.performedAt));

    return workoutRows.map((workout) =>
      toWorkoutRecord(
        workout,
        planRows
          .filter((row) => row.item.workoutId === workout.id)
          .map((row) => toWorkoutExercise(row.item)),
        setRows
          .filter((row) => row.set.workoutId === workout.id)
          .map((row) => toSetRecord(row.set)),
      ),
    );
  }

  async createWorkout(userId: string, input: CreateWorkoutInput): Promise<WorkoutMutationResult> {
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
        const existingPlan = await selectWorkoutPlan(transaction, existing.id);
        if (!sameWorkoutCreate(existing, input, existingPlan)) {
          throw new RepositoryConflictError(toWorkoutRecord(existing, existingPlan, []));
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
      await replaceWorkoutPlan(transaction, input.id, input.exercises);
      return false;
    });
    const entity = await this.getWorkout(userId, input.id);
    if (!entity) throw new RepositoryNotFoundError();
    return { entityType: 'workout', entity, duplicate };
  }

  async updateWorkout(userId: string, input: UpdateWorkoutInput): Promise<WorkoutMutationResult> {
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
      const existingPlan = await selectWorkoutPlan(transaction, existing.id);
      if (workoutChangesMatch(existing, input.changes, existingPlan)) return true;
      if (existing.revision !== input.baseRevision) {
        throw new RepositoryConflictError(toWorkoutRecord(existing, existingPlan, []));
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
        const currentPlan = await selectWorkoutPlan(transaction, current.id);
        if (workoutChangesMatch(current, input.changes, currentPlan)) return true;
        throw new RepositoryConflictError(toWorkoutRecord(current, currentPlan, []));
      }
      if (input.changes.exercises !== undefined) {
        await replaceWorkoutPlan(transaction, input.workoutId, input.changes.exercises);
      }
      return false;
    });
    const entity = await this.getWorkout(userId, input.workoutId);
    if (!entity) throw new RepositoryNotFoundError();
    return { entityType: 'workout', entity, duplicate };
  }

  async createSet(userId: string, input: CreateSetInput): Promise<SetMutationResult> {
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
        entrySource: input.set.entrySource,
        performedAt: new Date(input.set.performedAt),
        position: input.set.position,
      });
      return false;
    });
    const entity = await this.getSet(userId, input.set.id);
    if (!entity) throw new RepositoryNotFoundError();
    return { entityType: 'set', entity, duplicate };
  }

  async updateSet(userId: string, input: UpdateSetInput): Promise<SetMutationResult> {
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
          position: input.changes.position ?? existing.position,
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

  async deleteSet(userId: string, input: DeleteSetInput): Promise<DeleteMutationResult> {
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
      if (!existing) return true;
      if (existing.revision !== input.baseRevision) {
        throw new RepositoryConflictError(toSetRecord(existing));
      }

      const removed = await transaction
        .delete(sets)
        .where(and(eq(sets.id, existing.id), eq(sets.revision, input.baseRevision)))
        .returning({ id: sets.id });
      if (removed.length) return false;

      const currentRows = await transaction
        .select({ set: sets })
        .from(sets)
        .innerJoin(workouts, eq(sets.workoutId, workouts.id))
        .where(and(eq(sets.id, input.setId), eq(workouts.userId, userId)))
        .limit(1);
      const current = currentRows[0]?.set;
      if (!current) return true;
      throw new RepositoryConflictError(toSetRecord(current));
    });
    return { entityType: 'set', entity: null, entityId: input.setId, duplicate };
  }

  async listMeasurements(userId: string): Promise<MeasurementRecord[]> {
    const rows = await this.db
      .select()
      .from(measurementEntries)
      .where(eq(measurementEntries.userId, userId))
      .orderBy(desc(measurementEntries.measuredOn));
    return rows.map(toMeasurementRecord);
  }

  async createMeasurement(
    userId: string,
    input: CreateMeasurementInput,
  ): Promise<MeasurementMutationResult> {
    const duplicate = await this.db.transaction(async (transaction) => {
      const alreadyApplied = await recordMutation(transaction, userId, input.clientMutationId);
      if (alreadyApplied) return true;

      const existingRows = await transaction
        .select()
        .from(measurementEntries)
        .where(eq(measurementEntries.id, input.id))
        .limit(1);
      const existing = existingRows[0];
      if (existing) {
        if (existing.userId !== userId) throw new RepositoryConflictError(null);
        if (!sameMeasurementCreate(existing, input)) {
          throw new RepositoryConflictError(toMeasurementRecord(existing));
        }
        return true;
      }

      await transaction.insert(measurementEntries).values({
        id: input.id,
        userId,
        measuredOn: new Date(input.measuredOn),
        isSelfMeasured: input.isSelfMeasured,
        values: input.values,
      });
      return false;
    });
    const entity = await this.getMeasurement(userId, input.id);
    if (!entity) throw new RepositoryNotFoundError();
    return { entityType: 'measurement', entity, duplicate };
  }

  async updateMeasurement(
    userId: string,
    input: UpdateMeasurementInput,
  ): Promise<MeasurementMutationResult> {
    const duplicate = await this.db.transaction(async (transaction) => {
      const alreadyApplied = await recordMutation(transaction, userId, input.clientMutationId);
      if (alreadyApplied) return true;

      const existingRows = await transaction
        .select()
        .from(measurementEntries)
        .where(
          and(
            eq(measurementEntries.id, input.measurementId),
            eq(measurementEntries.userId, userId),
          ),
        )
        .limit(1);
      const existing = existingRows[0];
      if (!existing) throw new RepositoryNotFoundError();
      if (measurementChangesMatch(existing, input.changes)) return true;
      if (existing.revision !== input.baseRevision) {
        throw new RepositoryConflictError(toMeasurementRecord(existing));
      }

      const updated = await transaction
        .update(measurementEntries)
        .set({
          measuredOn:
            input.changes.measuredOn === undefined
              ? existing.measuredOn
              : new Date(input.changes.measuredOn),
          isSelfMeasured: input.changes.isSelfMeasured ?? existing.isSelfMeasured,
          values: input.changes.values ?? existing.values,
          revision: existing.revision + 1,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(measurementEntries.id, existing.id),
            eq(measurementEntries.userId, userId),
            eq(measurementEntries.revision, input.baseRevision),
          ),
        )
        .returning();
      if (updated.length) return false;

      const currentRows = await transaction
        .select()
        .from(measurementEntries)
        .where(
          and(
            eq(measurementEntries.id, input.measurementId),
            eq(measurementEntries.userId, userId),
          ),
        )
        .limit(1);
      const current = currentRows[0];
      if (!current) throw new RepositoryNotFoundError();
      if (measurementChangesMatch(current, input.changes)) return true;
      throw new RepositoryConflictError(toMeasurementRecord(current));
    });
    const entity = await this.getMeasurement(userId, input.measurementId);
    if (!entity) throw new RepositoryNotFoundError();
    return { entityType: 'measurement', entity, duplicate };
  }

  async deleteMeasurement(
    userId: string,
    input: DeleteMeasurementInput,
  ): Promise<DeleteMutationResult> {
    const duplicate = await this.db.transaction(async (transaction) => {
      const alreadyApplied = await recordMutation(transaction, userId, input.clientMutationId);
      if (alreadyApplied) return true;

      const existingRows = await transaction
        .select()
        .from(measurementEntries)
        .where(
          and(
            eq(measurementEntries.id, input.measurementId),
            eq(measurementEntries.userId, userId),
          ),
        )
        .limit(1);
      const existing = existingRows[0];
      if (!existing) return true;
      if (existing.revision !== input.baseRevision) {
        throw new RepositoryConflictError(toMeasurementRecord(existing));
      }

      const removed = await transaction
        .delete(measurementEntries)
        .where(
          and(
            eq(measurementEntries.id, existing.id),
            eq(measurementEntries.userId, userId),
            eq(measurementEntries.revision, input.baseRevision),
          ),
        )
        .returning({ id: measurementEntries.id });
      if (removed.length) return false;

      const currentRows = await transaction
        .select()
        .from(measurementEntries)
        .where(
          and(
            eq(measurementEntries.id, input.measurementId),
            eq(measurementEntries.userId, userId),
          ),
        )
        .limit(1);
      const current = currentRows[0];
      if (!current) return true;
      throw new RepositoryConflictError(toMeasurementRecord(current));
    });
    return {
      entityType: 'measurement',
      entity: null,
      entityId: input.measurementId,
      duplicate,
    };
  }

  async listVoiceEntries(userId: string): Promise<VoiceEntryRecord[]> {
    const rows = await this.db
      .select()
      .from(voiceEntries)
      .where(eq(voiceEntries.userId, userId))
      .orderBy(desc(voiceEntries.createdAt));
    return rows.map(toVoiceEntryRecord);
  }

  async createVoiceEntry(userId: string, input: VoiceEntryCreateInput) {
    if (input.workoutId) {
      const workout = await this.db
        .select({ id: workouts.id })
        .from(workouts)
        .where(and(eq(workouts.id, input.workoutId), eq(workouts.userId, userId)))
        .limit(1);
      if (!workout.length) throw new RepositoryNotFoundError();
    }

    await this.db
      .insert(voiceEntries)
      .values({
        ...input,
        userId,
      })
      .onConflictDoNothing({ target: voiceEntries.id });
    const rows = await this.db
      .select()
      .from(voiceEntries)
      .where(eq(voiceEntries.id, input.id))
      .limit(1);
    const entry = rows[0];
    if (!entry || entry.userId !== userId) throw new RepositoryConflictError(null);
    return toVoiceEntryRecord(entry);
  }

  async getVoiceObject(userId: string, voiceEntryId: string) {
    const rows = await this.db
      .select({ objectKey: voiceEntries.objectKey, mimeType: voiceEntries.mimeType })
      .from(voiceEntries)
      .where(and(eq(voiceEntries.id, voiceEntryId), eq(voiceEntries.userId, userId)))
      .limit(1);
    return rows[0] ?? null;
  }

  async deleteVoiceEntry(userId: string, voiceEntryId: string) {
    const deleted = await this.db
      .delete(voiceEntries)
      .where(and(eq(voiceEntries.id, voiceEntryId), eq(voiceEntries.userId, userId)))
      .returning({ id: voiceEntries.id });
    return deleted.length > 0;
  }

  async getNotificationPreferences(userId: string) {
    const rows = await this.db
      .select()
      .from(notificationPreferences)
      .where(eq(notificationPreferences.userId, userId))
      .limit(1);
    return rows[0] ? toNotificationPreferences(rows[0]) : defaultNotificationPreferences();
  }

  async updateNotificationPreferences(
    userId: string,
    input: UpdateNotificationPreferences,
    nextReminderAt: Date | null,
  ) {
    return this.db.transaction(async (transaction) => {
      const rows = await transaction
        .insert(notificationPreferences)
        .values({ ...input, userId, nextReminderAt })
        .onConflictDoUpdate({
          target: notificationPreferences.userId,
          set: { ...input, nextReminderAt, updatedAt: new Date() },
        })
        .returning();
      if (!input.enabled) {
        await transaction.delete(pushSubscriptions).where(eq(pushSubscriptions.userId, userId));
        for (const status of ['pending', 'processing'] as const) {
          await transaction
            .update(notificationJobs)
            .set({
              status: 'failed',
              claimedAt: null,
              nextAttemptAt: null,
              lastError: 'Notifications disabled by user',
              updatedAt: new Date(),
            })
            .where(and(eq(notificationJobs.userId, userId), eq(notificationJobs.status, status)));
        }
      }
      return toNotificationPreferences(rows[0]);
    });
  }

  async upsertPushSubscription(userId: string, input: PushSubscriptionInput, now: Date) {
    const expirationTime = input.expirationTime ? new Date(input.expirationTime) : null;
    await this.db
      .insert(pushSubscriptions)
      .values({
        id: randomUUID(),
        userId,
        endpoint: input.endpoint,
        expirationTime,
        p256dh: input.keys.p256dh,
        auth: input.keys.auth,
      })
      .onConflictDoUpdate({
        target: pushSubscriptions.endpoint,
        set: {
          userId,
          expirationTime,
          p256dh: input.keys.p256dh,
          auth: input.keys.auth,
          failureCount: 0,
          disabledAt: null,
          updatedAt: now,
        },
      });
  }

  async deletePushSubscription(userId: string, endpoint: string) {
    await this.db
      .delete(pushSubscriptions)
      .where(and(eq(pushSubscriptions.userId, userId), eq(pushSubscriptions.endpoint, endpoint)));
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
        role: requestedRole === 'admin' || requestedRole === 'trainer' ? requestedRole : 'athlete',
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
        unitSystem: users.unitSystem,
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
        unitSystem: users.unitSystem,
      })
      .from(users)
      .orderBy(asc(users.email));
    return records.map(toCurrentUser);
  }

  async updateUserPreferences(userId: string, input: UpdateUserPreferences) {
    const records = await this.db
      .update(users)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(users.id, userId))
      .returning();
    if (!records[0]) throw new RepositoryNotFoundError();
    return toCurrentUser(records[0]);
  }

  async createTrainerInvite(input: TrainerInviteCreateInput, now: Date) {
    const trainerRows = await this.db
      .select({ role: users.role })
      .from(users)
      .where(eq(users.id, input.trainerId))
      .limit(1);
    if (!trainerRows[0] || !canUseTrainerConsole(trainerRows[0].role)) {
      throw new RepositoryNotFoundError();
    }
    const created = await this.db
      .insert(trainerInvites)
      .values({
        id: input.id,
        trainerId: input.trainerId,
        email: input.email,
        tokenHash: input.tokenHash,
        expiresAt: input.expiresAt,
        createdAt: now,
      })
      .returning();
    return toTrainerInviteRecord(created[0], now);
  }

  async listTrainerInvites(trainerId: string, now: Date) {
    const records = await this.db
      .select()
      .from(trainerInvites)
      .where(eq(trainerInvites.trainerId, trainerId))
      .orderBy(desc(trainerInvites.createdAt));
    return records.map((invite) => toTrainerInviteRecord(invite, now));
  }

  async acceptTrainerInvite(tokenHash: string, athleteId: string, athleteEmail: string, now: Date) {
    return this.db.transaction(async (transaction) => {
      const inviteRows = await transaction
        .select()
        .from(trainerInvites)
        .where(eq(trainerInvites.tokenHash, tokenHash))
        .limit(1);
      const invite = inviteRows[0];
      if (!invite || invite.revokedAt) throw new RepositoryNotFoundError();
      if (invite.acceptedAt) {
        throw new RepositoryInviteError('invite_used', 'Invite was already used');
      }
      if (invite.expiresAt <= now) {
        throw new RepositoryInviteError('invite_expired', 'Invite has expired');
      }
      if (invite.email && invite.email !== athleteEmail.trim().toLowerCase()) {
        throw new RepositoryInviteError(
          'invite_email_mismatch',
          'Invite belongs to another Google account',
        );
      }
      if (invite.trainerId === athleteId) {
        throw new RepositoryInviteError('self_link', 'A user cannot coach their own account');
      }

      const trainerRows = await transaction
        .select({
          id: users.id,
          displayName: users.displayName,
          avatarUrl: users.avatarUrl,
          role: users.role,
        })
        .from(users)
        .where(eq(users.id, invite.trainerId))
        .limit(1);
      const trainer = trainerRows[0];
      if (!trainer || !canUseTrainerConsole(trainer.role)) throw new RepositoryNotFoundError();

      const claimed = await transaction
        .update(trainerInvites)
        .set({ acceptedByUserId: athleteId, acceptedAt: now })
        .where(
          and(
            eq(trainerInvites.id, invite.id),
            isNull(trainerInvites.acceptedAt),
            isNull(trainerInvites.revokedAt),
          ),
        )
        .returning({ id: trainerInvites.id });
      if (!claimed.length) {
        throw new RepositoryInviteError('invite_used', 'Invite was already used');
      }

      await transaction
        .update(trainerAthleteLinks)
        .set({ active: false, revokedAt: now, updatedAt: now })
        .where(
          and(eq(trainerAthleteLinks.athleteId, athleteId), eq(trainerAthleteLinks.active, true)),
        );
      const linked = await transaction
        .insert(trainerAthleteLinks)
        .values({
          id: randomUUID(),
          trainerId: trainer.id,
          athleteId,
          active: true,
          revokedAt: null,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing()
        .returning({ id: trainerAthleteLinks.id });
      if (!linked.length) {
        throw new RepositoryInviteError('invite_used', 'Athlete already has an active trainer');
      }
      return toTrainerSummary(trainer);
    });
  }

  async getAthleteTrainer(athleteId: string) {
    const records = await this.db
      .select({ id: users.id, displayName: users.displayName, avatarUrl: users.avatarUrl })
      .from(trainerAthleteLinks)
      .innerJoin(users, eq(trainerAthleteLinks.trainerId, users.id))
      .where(
        and(eq(trainerAthleteLinks.athleteId, athleteId), eq(trainerAthleteLinks.active, true)),
      )
      .limit(1);
    return records[0] ? toTrainerSummary(records[0]) : null;
  }

  async listTrainerAthletes(trainerId: string) {
    const records = await this.db
      .select({
        id: users.id,
        displayName: users.displayName,
        avatarUrl: users.avatarUrl,
        linkedAt: trainerAthleteLinks.createdAt,
      })
      .from(trainerAthleteLinks)
      .innerJoin(users, eq(trainerAthleteLinks.athleteId, users.id))
      .where(
        and(eq(trainerAthleteLinks.trainerId, trainerId), eq(trainerAthleteLinks.active, true)),
      )
      .orderBy(asc(users.displayName));
    return records.map((record) => ({
      id: record.id,
      displayName: record.displayName,
      avatarUrl: record.avatarUrl,
      linkedAt: record.linkedAt.toISOString(),
    }));
  }

  async listSharedWorkouts(trainerId: string, athleteId: string) {
    await this.assertTrainerLink(trainerId, athleteId);
    return this.listWorkouts(athleteId);
  }

  async listSharedMeasurements(trainerId: string, athleteId: string) {
    await this.assertTrainerLink(trainerId, athleteId);
    return this.listMeasurements(athleteId);
  }

  async revokeAthleteTrainer(athleteId: string, now: Date) {
    const revoked = await this.db
      .update(trainerAthleteLinks)
      .set({ active: false, revokedAt: now, updatedAt: now })
      .where(
        and(eq(trainerAthleteLinks.athleteId, athleteId), eq(trainerAthleteLinks.active, true)),
      )
      .returning({ id: trainerAthleteLinks.id });
    return revoked.length > 0;
  }

  async revokeTrainerAthlete(trainerId: string, athleteId: string, now: Date) {
    const revoked = await this.db
      .update(trainerAthleteLinks)
      .set({ active: false, revokedAt: now, updatedAt: now })
      .where(
        and(
          eq(trainerAthleteLinks.trainerId, trainerId),
          eq(trainerAthleteLinks.athleteId, athleteId),
          eq(trainerAthleteLinks.active, true),
        ),
      )
      .returning({ id: trainerAthleteLinks.id });
    return revoked.length > 0;
  }

  async revokeTrainerInvite(trainerId: string, inviteId: string, now: Date) {
    const revoked = await this.db
      .update(trainerInvites)
      .set({ revokedAt: now })
      .where(
        and(
          eq(trainerInvites.id, inviteId),
          eq(trainerInvites.trainerId, trainerId),
          isNull(trainerInvites.acceptedAt),
          isNull(trainerInvites.revokedAt),
        ),
      )
      .returning({ id: trainerInvites.id });
    return revoked.length > 0;
  }

  private async assertTrainerLink(trainerId: string, athleteId: string) {
    const links = await this.db
      .select({ id: trainerAthleteLinks.id })
      .from(trainerAthleteLinks)
      .where(
        and(
          eq(trainerAthleteLinks.trainerId, trainerId),
          eq(trainerAthleteLinks.athleteId, athleteId),
          eq(trainerAthleteLinks.active, true),
        ),
      )
      .limit(1);
    if (!links.length) throw new RepositoryNotFoundError();
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

  private async getMeasurement(userId: string, measurementId: string) {
    const rows = await this.db
      .select()
      .from(measurementEntries)
      .where(and(eq(measurementEntries.id, measurementId), eq(measurementEntries.userId, userId)))
      .limit(1);
    return rows[0] ? toMeasurementRecord(rows[0]) : null;
  }
}

type Database = ReturnType<typeof createDatabase>;
type MutationTransaction = Parameters<Parameters<Database['transaction']>[0]>[0];

async function selectWorkoutPlan(
  transaction: MutationTransaction,
  workoutId: string,
): Promise<WorkoutExercise[]> {
  const rows = await transaction
    .select()
    .from(workoutExercises)
    .where(eq(workoutExercises.workoutId, workoutId))
    .orderBy(asc(workoutExercises.position));
  return rows.map(toWorkoutExercise);
}

async function replaceWorkoutPlan(
  transaction: MutationTransaction,
  workoutId: string,
  plan: WorkoutExercise[],
) {
  await transaction.delete(workoutExercises).where(eq(workoutExercises.workoutId, workoutId));
  if (!plan.length) return;
  await transaction.insert(workoutExercises).values(
    orderedPlan(plan).map((item) => ({
      ...item,
      workoutId,
    })),
  );
}

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
  plan: WorkoutExercise[],
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
    exercises: orderedPlan(plan),
    sets: workoutSets,
  };
}

function toWorkoutExercise(item: typeof workoutExercises.$inferSelect): WorkoutExercise {
  return {
    id: item.id,
    exerciseId: item.exerciseId,
    position: item.position,
    supersetGroup: item.supersetGroup,
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
    entrySource: set.entrySource,
    performedAt: set.performedAt.toISOString(),
    position: set.position,
    revision: set.revision,
    updatedAt: set.updatedAt.toISOString(),
  };
}

function toPublicSet(set: MemorySet): SetRecord {
  const { userId: _userId, ...record } = set;
  return record;
}

function toMeasurementRecord(
  measurement: typeof measurementEntries.$inferSelect,
): MeasurementRecord {
  return {
    id: measurement.id,
    measuredOn: measurement.measuredOn.toISOString(),
    isSelfMeasured: measurement.isSelfMeasured,
    values: measurement.values as MeasurementValues,
    revision: measurement.revision,
    updatedAt: measurement.updatedAt.toISOString(),
  };
}

function toPublicMeasurement(measurement: MemoryMeasurement): MeasurementRecord {
  const { userId: _userId, ...record } = measurement;
  return record;
}

function defaultNotificationPreferences(): NotificationPreferences {
  return {
    enabled: false,
    frequency: 'daily',
    weekday: 1,
    reminderTime: '19:00',
    quietStart: '22:00',
    quietEnd: '08:00',
    timeZone: 'UTC',
    nextReminderAt: null,
  };
}

function toNotificationPreferences(
  preferences: typeof notificationPreferences.$inferSelect,
): NotificationPreferences {
  return {
    enabled: preferences.enabled,
    frequency: preferences.frequency,
    weekday: preferences.weekday,
    reminderTime: preferences.reminderTime,
    quietStart: preferences.quietStart,
    quietEnd: preferences.quietEnd,
    timeZone: preferences.timeZone,
    nextReminderAt: preferences.nextReminderAt?.toISOString() ?? null,
  };
}

function toVoiceEntryRecord(entry: typeof voiceEntries.$inferSelect): VoiceEntryRecord {
  return {
    id: entry.id,
    workoutId: entry.workoutId,
    status: entry.status,
    transcript: entry.transcript,
    createdAt: entry.createdAt.toISOString(),
    updatedAt: entry.updatedAt.toISOString(),
    lastError: entry.lastError,
  };
}

function toPublicVoiceEntry(entry: MemoryVoiceEntry): VoiceEntryRecord {
  return {
    id: entry.id,
    workoutId: entry.workoutId,
    status: entry.status,
    transcript: entry.transcript,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
    lastError: entry.lastError,
  };
}

function sameWorkoutCreate(
  workout: MemoryWorkout | typeof workouts.$inferSelect,
  input: CreateWorkoutInput,
  storedPlan: WorkoutExercise[] = 'exercises' in workout ? workout.exercises : [],
) {
  return (
    asIso(workout.startedAt) === input.startedAt &&
    asNullableIso(workout.endedAt) === input.endedAt &&
    workout.notes === input.notes &&
    workout.locale === input.locale &&
    samePlan(storedPlan, input.exercises)
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
    set.entrySource === input.set.entrySource &&
    asIso(set.performedAt) === input.set.performedAt &&
    set.position === input.set.position
  );
}

function sameMeasurementCreate(
  measurement: MemoryMeasurement | typeof measurementEntries.$inferSelect,
  input: CreateMeasurementInput,
) {
  return (
    asIso(measurement.measuredOn) === input.measuredOn &&
    measurement.isSelfMeasured === input.isSelfMeasured &&
    sameMeasurementValues(measurement.values, input.values)
  );
}

function workoutChangesMatch(
  workout: MemoryWorkout | typeof workouts.$inferSelect,
  changes: UpdateWorkoutInput['changes'],
  storedPlan: WorkoutExercise[] = 'exercises' in workout ? workout.exercises : [],
) {
  return (
    (changes.startedAt === undefined || asIso(workout.startedAt) === changes.startedAt) &&
    (!('endedAt' in changes) || asNullableIso(workout.endedAt) === (changes.endedAt ?? null)) &&
    (!('notes' in changes) || workout.notes === (changes.notes ?? null)) &&
    (changes.exercises === undefined || samePlan(storedPlan, changes.exercises))
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
    (changes.performedAt === undefined || asIso(set.performedAt) === changes.performedAt) &&
    (changes.position === undefined || set.position === changes.position)
  );
}

function measurementChangesMatch(
  measurement: MemoryMeasurement | typeof measurementEntries.$inferSelect,
  changes: UpdateMeasurementInput['changes'],
) {
  return (
    (changes.measuredOn === undefined || asIso(measurement.measuredOn) === changes.measuredOn) &&
    (changes.isSelfMeasured === undefined ||
      measurement.isSelfMeasured === changes.isSelfMeasured) &&
    (changes.values === undefined || sameMeasurementValues(measurement.values, changes.values))
  );
}

function sameMeasurementValues(left: unknown, right: MeasurementValues) {
  if (!left || typeof left !== 'object') return false;
  return Object.keys(right).every(
    (key) => (left as Record<string, unknown>)[key] === right[key as keyof MeasurementValues],
  );
}

function samePlan(left: WorkoutExercise[], right: WorkoutExercise[]) {
  const leftOrdered = orderedPlan(left);
  const rightOrdered = orderedPlan(right);
  return (
    leftOrdered.length === rightOrdered.length &&
    leftOrdered.every((item, index) => {
      const other = rightOrdered[index];
      return (
        item.id === other.id &&
        item.exerciseId === other.exerciseId &&
        item.position === other.position &&
        item.supersetGroup === other.supersetGroup
      );
    })
  );
}

function orderedPlan(plan: WorkoutExercise[]) {
  return plan.map((item) => ({ ...item })).sort((left, right) => left.position - right.position);
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
  unitSystem: string;
}): CurrentUser {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    role: user.role,
    locale: user.locale === 'en' ? 'en' : 'ru',
    unitSystem: user.unitSystem === 'imperial' ? 'imperial' : 'metric',
  };
}

function toExercise(record: typeof exercises.$inferSelect): Exercise {
  return {
    id: record.id,
    scope: record.scope,
    nameRu: record.nameRu,
    nameEn: record.nameEn,
    aliases: record.aliases,
    tag: record.tag,
    primaryMuscles: record.primaryMuscles as Exercise['primaryMuscles'],
    secondaryMuscles: record.secondaryMuscles as Exercise['secondaryMuscles'],
    equipment: record.equipment,
    videos: record.videos,
    sources: record.sources,
    notes: record.notes,
  };
}

function toTrainerSummary(user: {
  id: string;
  displayName: string;
  avatarUrl: string | null;
}): TrainerSummary {
  return { id: user.id, displayName: user.displayName, avatarUrl: user.avatarUrl };
}

function toTrainerInviteRecord(
  invite: MemoryTrainerInvite | typeof trainerInvites.$inferSelect,
  now: Date,
): TrainerInviteRecord {
  const status = invite.acceptedAt
    ? 'accepted'
    : invite.revokedAt
      ? 'revoked'
      : invite.expiresAt <= now
        ? 'expired'
        : 'pending';
  return {
    id: invite.id,
    email: invite.email,
    status,
    expiresAt: invite.expiresAt.toISOString(),
    createdAt: invite.createdAt.toISOString(),
  };
}

function canUseTrainerConsole(role: UserRole) {
  return role === 'trainer' || role === 'admin' || role === 'superadmin';
}

function resolvedRole(existingRole: UserRole | undefined, requestedRole: UserRole): UserRole {
  if (existingRole === 'superadmin') return existingRole;
  if (requestedRole === 'admin' || requestedRole === 'trainer') return requestedRole;
  return existingRole === 'trainer' ? 'trainer' : 'athlete';
}
