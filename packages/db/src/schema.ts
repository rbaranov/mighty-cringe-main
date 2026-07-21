import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const roleEnum = pgEnum('role', ['athlete', 'admin', 'trainer', 'superadmin']);
export const exerciseScopeEnum = pgEnum('exercise_scope', ['global', 'user']);
export const exerciseTagEnum = pgEnum('exercise_tag', ['mighty', 'normal', 'cringe']);
export const setEntrySourceEnum = pgEnum('set_entry_source', [
  'manual',
  'natural_text',
  'voice_ai',
]);
export const voiceStatusEnum = pgEnum('voice_status', [
  'pending',
  'processing',
  'confirmed',
  'failed',
]);

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
};

export const users = pgTable('users', {
  id: uuid('id').primaryKey(),
  googleSubject: varchar('google_subject', { length: 255 }).unique(),
  email: varchar('email', { length: 320 }).notNull().unique(),
  displayName: varchar('display_name', { length: 255 }).notNull(),
  avatarUrl: text('avatar_url'),
  role: roleEnum('role').notNull().default('athlete'),
  locale: varchar('locale', { length: 10 }).notNull().default('ru'),
  ...timestamps,
});

export const authAttempts = pgTable(
  'auth_attempts',
  {
    stateHash: varchar('state_hash', { length: 64 }).primaryKey(),
    codeVerifier: varchar('code_verifier', { length: 128 }).notNull(),
    nonce: varchar('nonce', { length: 128 }).notNull(),
    returnTo: varchar('return_to', { length: 2048 }).notNull().default('/'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('auth_attempt_expires_idx').on(table.expiresAt)],
);

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey(),
    tokenHash: varchar('token_hash', { length: 64 }).notNull().unique(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('session_user_idx').on(table.userId),
    index('session_expires_idx').on(table.expiresAt),
  ],
);

export const trainerAthleteLinks = pgTable(
  'trainer_athlete_links',
  {
    id: uuid('id').primaryKey(),
    trainerId: uuid('trainer_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    athleteId: uuid('athlete_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('one_active_trainer_per_athlete')
      .on(table.athleteId)
      .where(sql`${table.active} = true`),
    index('trainer_athlete_trainer_idx').on(table.trainerId),
  ],
);

export const exercises = pgTable(
  'exercises',
  {
    id: uuid('id').primaryKey(),
    scope: exerciseScopeEnum('scope').notNull().default('global'),
    ownerId: uuid('owner_id').references(() => users.id, { onDelete: 'cascade' }),
    nameRu: varchar('name_ru', { length: 255 }).notNull(),
    nameEn: varchar('name_en', { length: 255 }).notNull(),
    aliases: jsonb('aliases').notNull().$type<string[]>().default([]),
    tag: exerciseTagEnum('tag').notNull().default('normal'),
    primaryMuscles: jsonb('primary_muscles').notNull().$type<string[]>().default([]),
    secondaryMuscles: jsonb('secondary_muscles').notNull().$type<string[]>().default([]),
    equipment: jsonb('equipment').notNull().$type<string[]>().default([]),
    videos: jsonb('videos').notNull().$type<Array<{ title: string; url: string }>>().default([]),
    notes: text('notes'),
    ...timestamps,
  },
  (table) => [index('exercise_scope_owner_idx').on(table.scope, table.ownerId)],
);

export const workouts = pgTable(
  'workouts',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    locale: varchar('locale', { length: 10 }).notNull().default('ru'),
    notes: text('notes'),
    revision: integer('revision').notNull().default(1),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [index('workout_user_started_idx').on(table.userId, table.startedAt)],
);

export const workoutExercises = pgTable(
  'workout_exercises',
  {
    id: uuid('id').primaryKey(),
    workoutId: uuid('workout_id')
      .notNull()
      .references(() => workouts.id, { onDelete: 'cascade' }),
    exerciseId: uuid('exercise_id')
      .notNull()
      .references(() => exercises.id),
    supersetGroup: integer('superset_group'),
    position: integer('position').notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('workout_exercise_position_idx').on(table.workoutId, table.position),
    index('workout_exercise_workout_idx').on(table.workoutId),
  ],
);

export const sets = pgTable(
  'sets',
  {
    id: uuid('id').primaryKey(),
    workoutId: uuid('workout_id')
      .notNull()
      .references(() => workouts.id, { onDelete: 'cascade' }),
    exerciseId: uuid('exercise_id')
      .notNull()
      .references(() => exercises.id),
    weightKg: numeric('weight_kg', { precision: 6, scale: 2 }).notNull(),
    reps: integer('reps').notNull(),
    rir: integer('rir'),
    comment: text('comment'),
    entrySource: setEntrySourceEnum('entry_source').notNull().default('manual'),
    performedAt: timestamp('performed_at', { withTimezone: true }).notNull(),
    position: integer('position').notNull().default(0),
    revision: integer('revision').notNull().default(1),
    ...timestamps,
  },
  (table) => [index('set_workout_exercise_idx').on(table.workoutId, table.exerciseId)],
);

export const voiceEntries = pgTable(
  'voice_entries',
  {
    id: uuid('id').primaryKey(),
    workoutId: uuid('workout_id').references(() => workouts.id, { onDelete: 'set null' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    objectKey: varchar('object_key', { length: 1024 }).notNull(),
    mimeType: varchar('mime_type', { length: 255 }).notNull(),
    audioFormat: varchar('audio_format', { length: 16 }).notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    consentVersion: varchar('consent_version', { length: 32 }).notNull(),
    transcript: text('transcript'),
    parsedResult: jsonb('parsed_result'),
    status: voiceStatusEnum('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }),
    lastError: text('last_error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('voice_user_created_idx').on(table.userId, table.createdAt),
    index('voice_pending_retry_idx').on(table.status, table.nextAttemptAt),
  ],
);

export const measurementEntries = pgTable(
  'measurement_entries',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    measuredOn: timestamp('measured_on', { withTimezone: true }).notNull(),
    isSelfMeasured: boolean('is_self_measured').notNull().default(false),
    values: jsonb('values').notNull(),
    revision: integer('revision').notNull().default(1),
    ...timestamps,
  },
  (table) => [index('measurement_user_date_idx').on(table.userId, table.measuredOn)],
);

export const clientMutations = pgTable(
  'client_mutations',
  {
    id: uuid('id').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    appliedAt: timestamp('applied_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.id, table.userId] })],
);
