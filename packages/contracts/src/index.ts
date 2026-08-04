import { z } from 'zod';

export { globalExerciseCatalog, retiredGlobalExerciseIds } from './globalCatalog.js';

export const muscleGroups = [
  'chest',
  'back',
  'front_delt',
  'middle_delt',
  'rear_delt',
  'biceps',
  'triceps',
  'quadriceps',
  'hamstrings',
  'glutes',
  'adductors',
  'calves',
  'core',
] as const;

export const exerciseTags = ['mighty', 'normal', 'cringe'] as const;
export const exercisePreferenceValues = ['like', 'dislike'] as const;
export const userRoles = ['athlete', 'admin', 'trainer', 'superadmin'] as const;
export const voiceStatuses = ['pending', 'processing', 'confirmed', 'failed'] as const;
export const setEntrySources = ['manual', 'natural_text', 'voice_ai'] as const;
export const notificationFrequencies = ['daily', 'weekdays', 'weekly'] as const;
export const unitSystems = ['metric', 'imperial'] as const;

export const currentUserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  displayName: z.string().min(1),
  avatarUrl: z.string().url().nullable(),
  role: z.enum(userRoles),
  locale: z.enum(['ru', 'en']),
  unitSystem: z.enum(unitSystems),
});

export const updateUserPreferencesSchema = z.object({
  locale: z.enum(['ru', 'en']),
  unitSystem: z.enum(unitSystems),
});

export const exerciseLinkSchema = z.object({
  title: z.string().trim().min(1).max(200),
  url: z
    .string()
    .url()
    .max(2_048)
    .refine((url) => url.startsWith('https://'), 'Exercise links must use HTTPS'),
});

export const exerciseSchema = z.object({
  id: z.string().uuid(),
  scope: z.enum(['global', 'user']).optional(),
  deletedAt: z.string().datetime().nullable().optional(),
  nameRu: z.string().min(1).max(80),
  nameEn: z.string().min(1).max(80),
  aliases: z.array(z.string()),
  tag: z.enum(exerciseTags),
  primaryMuscles: z.array(z.enum(muscleGroups)).min(1),
  secondaryMuscles: z.array(z.enum(muscleGroups)),
  equipment: z.array(z.string()),
  videos: z.array(exerciseLinkSchema).max(5).optional(),
  sources: z.array(exerciseLinkSchema).max(8).optional(),
  notes: z.string().max(2_000).nullable().optional(),
});

const exerciseDetailsSchema = z.object({
  nameRu: z.string().trim().min(1).max(80),
  nameEn: z.string().trim().min(1).max(80),
  aliases: z.array(z.string().trim().min(1).max(255)).max(20),
  tag: z.enum(exerciseTags),
  primaryMuscles: z.array(z.enum(muscleGroups)).min(1).max(4),
  secondaryMuscles: z.array(z.enum(muscleGroups)).max(6),
  equipment: z.array(z.string().trim().min(1).max(100)).max(10),
  videos: z.array(exerciseLinkSchema).max(5),
  sources: z.array(exerciseLinkSchema).max(8),
  notes: z.string().trim().min(1).max(2_000).nullable(),
});

const ambiguousExerciseNames = new Set([
  'пуловер',
  'жим',
  'тяга',
  'сгибание рук',
  'разгибание рук',
  'сведение рук',
  'разведение рук',
  'пресс',
  'пэк дек',
  'пэкдэк',
  'тренажер скотта',
  'тренажёр скотта',
  'чест пресс',
  'pullover',
  'press',
  'row',
  'curl',
  'extension',
  'fly',
  'chest press',
  'pec deck',
]);

export function exerciseNameIssue(name: string): 'ambiguous' | null {
  return ambiguousExerciseNames.has(name.trim().toLocaleLowerCase('ru-RU')) ? 'ambiguous' : null;
}

function canonicalExerciseNamesRefinement(
  value: { nameRu: string; nameEn: string },
  context: z.RefinementCtx,
) {
  for (const field of ['nameRu', 'nameEn'] as const) {
    if (exerciseNameIssue(value[field]) === null) continue;
    context.addIssue({
      code: 'custom',
      message:
        'Exercise name must include the movement and the distinguishing equipment, position, angle or grip',
      path: [field],
    });
  }
}

export const createExerciseSchema = exerciseDetailsSchema
  .extend({
    id: z.string().uuid(),
  })
  .superRefine(canonicalExerciseNamesRefinement);

export const createExerciseMutationSchema = exerciseDetailsSchema
  .extend({
    id: z.string().uuid(),
    clientMutationId: z.string().uuid(),
  })
  .superRefine(canonicalExerciseNamesRefinement);

export const updateExerciseSchema = exerciseDetailsSchema
  .extend({
    sources: z.array(exerciseLinkSchema).max(8),
  })
  .superRefine(canonicalExerciseNamesRefinement);
export const exerciseIdSchema = z.string().uuid();

export const exercisePreferenceRecordSchema = z.object({
  exerciseId: exerciseIdSchema,
  value: z.enum(exercisePreferenceValues).nullable(),
  revision: z.number().int().positive(),
  updatedAt: z.string().datetime(),
});

export const setExercisePreferenceSchema = z.object({
  clientMutationId: z.string().uuid(),
  exerciseId: exerciseIdSchema,
  value: z.enum(exercisePreferenceValues).nullable(),
  baseRevision: z.number().int().nonnegative(),
});

export const exerciseDiscoveryQuerySchema = z.object({
  query: z.string().trim().min(2).max(200),
  locale: z.enum(['ru', 'en']).default('ru'),
});

export const exerciseDiscoveryCandidateSchema = exerciseDetailsSchema
  .extend({
    sources: z.array(exerciseLinkSchema).min(1).max(8),
    confidence: z.enum(['high', 'medium', 'low']),
    matchReason: z.string().trim().min(1).max(500),
  })
  .superRefine(canonicalExerciseNamesRefinement);

export const exerciseDiscoveryResultSchema = z.object({
  query: z.string().min(1),
  candidates: z.array(exerciseDiscoveryCandidateSchema).max(3),
});

export const exerciseDiscoveryPhases = [
  'information',
  'video',
  'structuring',
  'verification',
] as const;

export const startExerciseDiscoverySchema = exerciseDiscoveryQuerySchema.extend({
  exerciseId: z.string().uuid().optional(),
});

export const exerciseDiscoveryJobSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(['running', 'completed', 'failed', 'cancelled']),
  startedAt: z.string().datetime(),
  phases: z.array(
    z.object({
      phase: z.enum(exerciseDiscoveryPhases),
      status: z.enum(['pending', 'running', 'completed', 'failed', 'skipped']),
    }),
  ),
  result: exerciseDiscoveryResultSchema.nullable(),
  error: z.enum(['discovery_unavailable']).nullable(),
});

export const workoutExerciseSchema = z.object({
  id: z.string().uuid(),
  exerciseId: z.string().uuid(),
  position: z.number().int().nonnegative(),
  supersetGroup: z.number().int().positive().nullable(),
});

export const workoutPlanSchema = z
  .array(workoutExerciseSchema)
  .max(100)
  .superRefine((items, context) => {
    const ids = new Set<string>();
    const positions = new Set<number>();
    const groups = new Map<number, number[]>();
    for (const [index, item] of items.entries()) {
      if (ids.has(item.id)) {
        context.addIssue({
          code: 'custom',
          message: 'Plan item ids must be unique',
          path: [index, 'id'],
        });
      }
      if (positions.has(item.position)) {
        context.addIssue({
          code: 'custom',
          message: 'Plan positions must be unique',
          path: [index, 'position'],
        });
      }
      ids.add(item.id);
      positions.add(item.position);
      if (item.supersetGroup !== null) {
        const groupPositions = groups.get(item.supersetGroup) ?? [];
        groupPositions.push(item.position);
        groups.set(item.supersetGroup, groupPositions);
      }
    }
    for (const [group, groupPositions] of groups) {
      const ordered = groupPositions.sort((left, right) => left - right);
      const consecutive = ordered.every(
        (position, index) => index === 0 || position === ordered[index - 1] + 1,
      );
      if (ordered.length < 2 || !consecutive) {
        context.addIssue({
          code: 'custom',
          message: `Superset group ${group} must contain consecutive exercises`,
        });
      }
    }
  });

export const setInputSchema = z.object({
  id: z.string().uuid(),
  exerciseId: z.string().uuid(),
  weightKg: z.number().nonnegative().max(1000),
  reps: z.number().int().min(1).max(100),
  rir: z.number().int().min(0).max(20).nullable(),
  comment: z.string().max(1_000).nullable(),
  entrySource: z.enum(setEntrySources).default('manual'),
  performedAt: z.string().datetime(),
  position: z.number().int().nonnegative().default(0),
});

export const setRecordSchema = setInputSchema.extend({
  workoutId: z.string().uuid(),
  revision: z.number().int().positive(),
  updatedAt: z.string().datetime(),
});

const optionalMeasurement = (maximum: number) =>
  z.number().positive().max(maximum).nullable().default(null);

export const rfmSexes = ['male', 'female'] as const;

export const measurementValuesSchema = z
  .object({
    heightCm: optionalMeasurement(300),
    weightKg: optionalMeasurement(500),
    neckCm: optionalMeasurement(200),
    chestCm: optionalMeasurement(300),
    bicepsCm: optionalMeasurement(150),
    thighLeftCm: optionalMeasurement(200),
    thighRightCm: optionalMeasurement(200),
    calfCm: optionalMeasurement(150),
    waistCm: optionalMeasurement(300),
    bodyFatPercent: optionalMeasurement(100),
    rfmSex: z.enum(rfmSexes).nullable().default(null),
  })
  .refine(
    (values) => Object.entries(values).some(([key, value]) => key !== 'rfmSex' && value !== null),
    {
      message: 'At least one measurement value is required',
    },
  );

export const measurementRecordSchema = z.object({
  id: z.string().uuid(),
  measuredOn: z.string().datetime(),
  isSelfMeasured: z.boolean(),
  values: measurementValuesSchema,
  revision: z.number().int().positive(),
  updatedAt: z.string().datetime(),
});

export const voiceEntryRecordSchema = z.object({
  id: z.string().uuid(),
  workoutId: z.string().uuid().nullable(),
  status: z.enum(voiceStatuses),
  transcript: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  lastError: z.string().nullable(),
});
export const voiceEntryIdSchema = z.string().uuid();

const localTimeSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Time must use the HH:mm format');

export const notificationPreferencesSchema = z.object({
  enabled: z.boolean(),
  frequency: z.enum(notificationFrequencies),
  weekday: z.number().int().min(0).max(6),
  reminderTime: localTimeSchema,
  quietStart: localTimeSchema,
  quietEnd: localTimeSchema,
  timeZone: z.string().trim().min(1).max(100),
  nextReminderAt: z.string().datetime().nullable(),
});

export const updateNotificationPreferencesSchema = notificationPreferencesSchema.omit({
  nextReminderAt: true,
});

export const pushSubscriptionSchema = z.object({
  endpoint: z
    .string()
    .url()
    .max(4_096)
    .refine((endpoint) => endpoint.startsWith('https://'), 'A secure push endpoint is required'),
  expirationTime: z.number().nonnegative().nullable().default(null),
  keys: z.object({
    p256dh: z.string().min(32).max(512),
    auth: z.string().min(16).max(256),
  }),
});

export const deletePushSubscriptionSchema = z.object({
  endpoint: pushSubscriptionSchema.shape.endpoint,
});

export const trainerInviteCreateSchema = z.object({
  email: z
    .string()
    .trim()
    .email()
    .transform((email) => email.toLowerCase())
    .nullable()
    .default(null),
});

export const trainerInviteAcceptSchema = z.object({
  token: z
    .string()
    .min(32)
    .max(256)
    .regex(/^[A-Za-z0-9_-]+$/),
});

export const trainerInviteIdSchema = z.string().uuid();
export const trainerAthleteIdSchema = z.string().uuid();

export const trainerSummarySchema = z.object({
  id: z.string().uuid(),
  displayName: z.string().min(1),
  avatarUrl: z.string().url().nullable(),
});

export const trainerInviteRecordSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email().nullable(),
  status: z.enum(['pending', 'accepted', 'expired', 'revoked']),
  expiresAt: z.string().datetime(),
  createdAt: z.string().datetime(),
});

export const trainerAthleteSummarySchema = z.object({
  id: z.string().uuid(),
  displayName: z.string().min(1),
  avatarUrl: z.string().url().nullable(),
  linkedAt: z.string().datetime(),
});

export const createMeasurementSchema = z.object({
  id: z.string().uuid(),
  clientMutationId: z.string().uuid(),
  measuredOn: z.string().datetime(),
  isSelfMeasured: z.boolean().default(false),
  values: measurementValuesSchema,
});

const measurementChangesSchema = z
  .object({
    measuredOn: z.string().datetime().optional(),
    isSelfMeasured: z.boolean().optional(),
    values: measurementValuesSchema.optional(),
  })
  .refine((changes) => Object.keys(changes).length > 0, 'At least one change is required');

export const updateMeasurementSchema = z.object({
  clientMutationId: z.string().uuid(),
  measurementId: z.string().uuid(),
  baseRevision: z.number().int().nonnegative(),
  changes: measurementChangesSchema,
});

export const deleteMeasurementSchema = z.object({
  clientMutationId: z.string().uuid(),
  measurementId: z.string().uuid(),
  baseRevision: z.number().int().nonnegative(),
});

export const createWorkoutSchema = z
  .object({
    id: z.string().uuid(),
    clientMutationId: z.string().uuid(),
    startedAt: z.string().datetime(),
    endedAt: z.string().datetime().nullable().default(null),
    durationSeconds: z.number().int().nonnegative().default(0),
    activeSegmentStartedAt: z.string().datetime().nullable().optional(),
    lastActivityAt: z.string().datetime().optional(),
    completionReason: z.enum(['manual', 'automatic']).nullable().default(null),
    isFavorite: z.boolean().default(false),
    notes: z.string().max(10_000).nullable().default(null),
    locale: z.enum(['ru', 'en']).default('ru'),
    exercises: workoutPlanSchema.default([]),
    activityAt: z.string().datetime().optional(),
  })
  .transform((input) => ({
    ...input,
    activeSegmentStartedAt:
      input.activeSegmentStartedAt === undefined
        ? input.endedAt === null
          ? input.startedAt
          : null
        : input.activeSegmentStartedAt,
    lastActivityAt: input.lastActivityAt ?? input.startedAt,
  }));

export const createSetSchema = z.object({
  clientMutationId: z.string().uuid(),
  workoutId: z.string().uuid(),
  set: setInputSchema,
  activityAt: z.string().datetime().optional(),
});

const workoutChangesSchema = z
  .object({
    startedAt: z.string().datetime().optional(),
    endedAt: z.string().datetime().nullable().optional(),
    durationSeconds: z.number().int().nonnegative().optional(),
    activeSegmentStartedAt: z.string().datetime().nullable().optional(),
    lastActivityAt: z.string().datetime().optional(),
    completionReason: z.enum(['manual', 'automatic']).nullable().optional(),
    isFavorite: z.boolean().optional(),
    notes: z.string().max(10_000).nullable().optional(),
    exercises: workoutPlanSchema.optional(),
  })
  .refine((changes) => Object.keys(changes).length > 0, 'At least one change is required');

export const updateWorkoutSchema = z.object({
  clientMutationId: z.string().uuid(),
  workoutId: z.string().uuid(),
  baseRevision: z.number().int().nonnegative(),
  changes: workoutChangesSchema,
  activityAt: z.string().datetime().optional(),
});

export const touchWorkoutSchema = z.object({
  clientMutationId: z.string().uuid(),
  workoutId: z.string().uuid(),
  activityAt: z.string().datetime(),
});

export const deleteWorkoutSchema = z.object({
  clientMutationId: z.string().uuid(),
  workoutId: z.string().uuid(),
  baseRevision: z.number().int().nonnegative(),
  activityAt: z.string().datetime().optional(),
});

const setChangesSchema = z
  .object({
    weightKg: z.number().nonnegative().max(1000).optional(),
    reps: z.number().int().min(1).max(100).optional(),
    rir: z.number().int().min(0).max(20).nullable().optional(),
    comment: z.string().max(1_000).nullable().optional(),
    performedAt: z.string().datetime().optional(),
    position: z.number().int().nonnegative().optional(),
  })
  .strict()
  .refine((changes) => Object.keys(changes).length > 0, 'At least one change is required');

export const updateSetSchema = z.object({
  clientMutationId: z.string().uuid(),
  workoutId: z.string().uuid(),
  setId: z.string().uuid(),
  baseRevision: z.number().int().nonnegative(),
  changes: setChangesSchema,
  activityAt: z.string().datetime().optional(),
});

export const deleteSetSchema = z.object({
  clientMutationId: z.string().uuid(),
  workoutId: z.string().uuid(),
  setId: z.string().uuid(),
  baseRevision: z.number().int().nonnegative(),
  activityAt: z.string().datetime().optional(),
});

export const syncMutationSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('exercise.create'), payload: createExerciseMutationSchema }),
  z.object({
    type: z.literal('exercise-preference.set'),
    payload: setExercisePreferenceSchema,
  }),
  z.object({ type: z.literal('workout.create'), payload: createWorkoutSchema }),
  z.object({ type: z.literal('workout.update'), payload: updateWorkoutSchema }),
  z.object({ type: z.literal('workout.touch'), payload: touchWorkoutSchema }),
  z.object({ type: z.literal('workout.delete'), payload: deleteWorkoutSchema }),
  z.object({ type: z.literal('set.create'), payload: createSetSchema }),
  z.object({ type: z.literal('set.update'), payload: updateSetSchema }),
  z.object({ type: z.literal('set.delete'), payload: deleteSetSchema }),
  z.object({ type: z.literal('measurement.create'), payload: createMeasurementSchema }),
  z.object({ type: z.literal('measurement.update'), payload: updateMeasurementSchema }),
  z.object({ type: z.literal('measurement.delete'), payload: deleteMeasurementSchema }),
]);

export const workoutRecordSchema = z.object({
  id: z.string().uuid(),
  startedAt: z.string().datetime(),
  endedAt: z.string().datetime().nullable(),
  durationSeconds: z.number().int().nonnegative(),
  activeSegmentStartedAt: z.string().datetime().nullable(),
  lastActivityAt: z.string().datetime(),
  completionReason: z.enum(['manual', 'automatic']).nullable(),
  isFavorite: z.boolean(),
  notes: z.string().nullable(),
  locale: z.enum(['ru', 'en']),
  revision: z.number().int().positive(),
  updatedAt: z.string().datetime(),
  exercises: workoutPlanSchema,
  sets: z.array(setRecordSchema),
});

export type Exercise = z.infer<typeof exerciseSchema>;
export type ExercisePreferenceValue = (typeof exercisePreferenceValues)[number];
export type ExercisePreferenceRecord = z.infer<typeof exercisePreferenceRecordSchema>;
export type SetExercisePreferenceInput = z.infer<typeof setExercisePreferenceSchema>;
export type CreateExerciseInput = z.infer<typeof createExerciseSchema>;
export type CreateExerciseMutationInput = z.infer<typeof createExerciseMutationSchema>;
export type UpdateExerciseInput = z.infer<typeof updateExerciseSchema>;
export type ExerciseDiscoveryCandidate = z.infer<typeof exerciseDiscoveryCandidateSchema>;
export type ExerciseDiscoveryResult = z.infer<typeof exerciseDiscoveryResultSchema>;
export type StartExerciseDiscoveryInput = z.infer<typeof startExerciseDiscoverySchema>;
export type ExerciseDiscoveryJob = z.infer<typeof exerciseDiscoveryJobSchema>;
export type ExerciseDiscoveryPhase = (typeof exerciseDiscoveryPhases)[number];
export type WorkoutExercise = z.infer<typeof workoutExerciseSchema>;
export type SetInput = z.infer<typeof setInputSchema>;
export type SetEntrySource = SetInput['entrySource'];
export type CreateWorkoutInput = z.infer<typeof createWorkoutSchema>;
export type CreateSetInput = z.infer<typeof createSetSchema>;
export type UpdateWorkoutInput = z.infer<typeof updateWorkoutSchema>;
export type TouchWorkoutInput = z.infer<typeof touchWorkoutSchema>;
export type DeleteWorkoutInput = z.infer<typeof deleteWorkoutSchema>;
export type UpdateSetInput = z.infer<typeof updateSetSchema>;
export type DeleteSetInput = z.infer<typeof deleteSetSchema>;
export type MeasurementValues = z.infer<typeof measurementValuesSchema>;
export type MeasurementNumericKey = Exclude<keyof MeasurementValues, 'rfmSex'>;
export type RfmSex = (typeof rfmSexes)[number];
export type MeasurementRecord = z.infer<typeof measurementRecordSchema>;
export type VoiceEntryRecord = z.infer<typeof voiceEntryRecordSchema>;
export type NotificationPreferences = z.infer<typeof notificationPreferencesSchema>;
export type UpdateNotificationPreferences = z.infer<typeof updateNotificationPreferencesSchema>;
export type PushSubscriptionInput = z.infer<typeof pushSubscriptionSchema>;
export type TrainerSummary = z.infer<typeof trainerSummarySchema>;
export type TrainerInviteRecord = z.infer<typeof trainerInviteRecordSchema>;
export type TrainerAthleteSummary = z.infer<typeof trainerAthleteSummarySchema>;
export type CreateMeasurementInput = z.infer<typeof createMeasurementSchema>;
export type UpdateMeasurementInput = z.infer<typeof updateMeasurementSchema>;
export type DeleteMeasurementInput = z.infer<typeof deleteMeasurementSchema>;
export type SyncMutation = z.infer<typeof syncMutationSchema>;
export type SetRecord = z.infer<typeof setRecordSchema>;
export type WorkoutRecord = z.infer<typeof workoutRecordSchema>;
export type CurrentUser = z.infer<typeof currentUserSchema>;
export type UpdateUserPreferences = z.infer<typeof updateUserPreferencesSchema>;
export type UnitSystem = CurrentUser['unitSystem'];
export type UserRole = CurrentUser['role'];
