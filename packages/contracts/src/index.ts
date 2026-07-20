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
export const userRoles = ['athlete', 'trainer', 'superadmin'] as const;

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

export const setInputSchema = z.object({
  id: z.string().uuid(),
  exerciseId: z.string().uuid(),
  weightKg: z.number().nonnegative().max(1000),
  reps: z.number().int().min(1).max(100),
  rir: z.number().int().min(0).max(20).nullable(),
  comment: z.string().max(1_000).nullable(),
  performedAt: z.string().datetime(),
});

export const createWorkoutSchema = z.object({
  id: z.string().uuid(),
  clientMutationId: z.string().uuid(),
  startedAt: z.string().datetime(),
  locale: z.enum(['ru', 'en']).default('ru'),
});

export const createSetSchema = z.object({
  clientMutationId: z.string().uuid(),
  workoutId: z.string().uuid(),
  set: setInputSchema,
});

export const syncMutationSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('workout.create'), payload: createWorkoutSchema }),
  z.object({ type: z.literal('set.create'), payload: createSetSchema }),
]);

export type Exercise = z.infer<typeof exerciseSchema>;
export type SetInput = z.infer<typeof setInputSchema>;
export type CreateWorkoutInput = z.infer<typeof createWorkoutSchema>;
export type CreateSetInput = z.infer<typeof createSetSchema>;
export type SyncMutation = z.infer<typeof syncMutationSchema>;
