import { z } from 'zod';

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
  'calves',
  'core',
] as const;

export const exerciseTags = ['mighty', 'normal', 'cringe'] as const;
export const userRoles = ['athlete', 'admin', 'trainer', 'superadmin'] as const;
export const voiceStatuses = ['pending', 'processing', 'confirmed', 'failed'] as const;
export const setEntrySources = ['manual', 'natural_text', 'voice_ai'] as const;

export const currentUserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  displayName: z.string().min(1),
  avatarUrl: z.string().url().nullable(),
  role: z.enum(userRoles),
  locale: z.enum(['ru', 'en']),
});

export const exerciseSchema = z.object({
  id: z.string().uuid(),
  nameRu: z.string().min(1),
  nameEn: z.string().min(1),
  aliases: z.array(z.string()),
  tag: z.enum(exerciseTags),
  primaryMuscles: z.array(z.enum(muscleGroups)).min(1),
  secondaryMuscles: z.array(z.enum(muscleGroups)),
  equipment: z.array(z.string()),
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
  })
  .refine((values) => Object.values(values).some((value) => value !== null), {
    message: 'At least one measurement value is required',
  });

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

export const createWorkoutSchema = z.object({
  id: z.string().uuid(),
  clientMutationId: z.string().uuid(),
  startedAt: z.string().datetime(),
  endedAt: z.string().datetime().nullable().default(null),
  notes: z.string().max(10_000).nullable().default(null),
  locale: z.enum(['ru', 'en']).default('ru'),
  exercises: workoutPlanSchema.default([]),
});

export const createSetSchema = z.object({
  clientMutationId: z.string().uuid(),
  workoutId: z.string().uuid(),
  set: setInputSchema,
});

const workoutChangesSchema = z
  .object({
    startedAt: z.string().datetime().optional(),
    endedAt: z.string().datetime().nullable().optional(),
    notes: z.string().max(10_000).nullable().optional(),
    exercises: workoutPlanSchema.optional(),
  })
  .refine((changes) => Object.keys(changes).length > 0, 'At least one change is required');

export const updateWorkoutSchema = z.object({
  clientMutationId: z.string().uuid(),
  workoutId: z.string().uuid(),
  baseRevision: z.number().int().nonnegative(),
  changes: workoutChangesSchema,
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
});

export const deleteSetSchema = z.object({
  clientMutationId: z.string().uuid(),
  workoutId: z.string().uuid(),
  setId: z.string().uuid(),
  baseRevision: z.number().int().nonnegative(),
});

export const syncMutationSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('workout.create'), payload: createWorkoutSchema }),
  z.object({ type: z.literal('workout.update'), payload: updateWorkoutSchema }),
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
  notes: z.string().nullable(),
  locale: z.enum(['ru', 'en']),
  revision: z.number().int().positive(),
  updatedAt: z.string().datetime(),
  exercises: workoutPlanSchema,
  sets: z.array(setRecordSchema),
});

export type Exercise = z.infer<typeof exerciseSchema>;
export type WorkoutExercise = z.infer<typeof workoutExerciseSchema>;
export type SetInput = z.infer<typeof setInputSchema>;
export type SetEntrySource = SetInput['entrySource'];
export type CreateWorkoutInput = z.infer<typeof createWorkoutSchema>;
export type CreateSetInput = z.infer<typeof createSetSchema>;
export type UpdateWorkoutInput = z.infer<typeof updateWorkoutSchema>;
export type UpdateSetInput = z.infer<typeof updateSetSchema>;
export type DeleteSetInput = z.infer<typeof deleteSetSchema>;
export type MeasurementValues = z.infer<typeof measurementValuesSchema>;
export type MeasurementRecord = z.infer<typeof measurementRecordSchema>;
export type VoiceEntryRecord = z.infer<typeof voiceEntryRecordSchema>;
export type CreateMeasurementInput = z.infer<typeof createMeasurementSchema>;
export type UpdateMeasurementInput = z.infer<typeof updateMeasurementSchema>;
export type DeleteMeasurementInput = z.infer<typeof deleteMeasurementSchema>;
export type SyncMutation = z.infer<typeof syncMutationSchema>;
export type SetRecord = z.infer<typeof setRecordSchema>;
export type WorkoutRecord = z.infer<typeof workoutRecordSchema>;
export type CurrentUser = z.infer<typeof currentUserSchema>;
export type UserRole = CurrentUser['role'];
