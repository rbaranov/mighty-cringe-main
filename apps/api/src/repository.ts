import type { CreateSetInput, CreateWorkoutInput, Exercise } from '@mighty-cringe/contracts';
import {
  and,
  clientMutations,
  createDatabase,
  desc,
  eq,
  exercises,
  isNull,
  sets,
  users,
  workouts,
} from '@mighty-cringe/db';

import { catalog } from './catalog.js';

const developmentUser = {
  id: '00000000-0000-4000-8000-000000000001',
  email: 'demo@mightycringe.local',
  displayName: 'R',
};

export type WorkoutSummary = {
  id: string;
  startedAt: string;
  endedAt: string | null;
  setCount: number;
};

export interface WorkoutRepository {
  listExercises(): Promise<Exercise[]>;
  listWorkouts(userId: string): Promise<WorkoutSummary[]>;
  createWorkout(
    userId: string,
    input: CreateWorkoutInput,
  ): Promise<{ id: string; duplicate: boolean }>;
  createSet(userId: string, input: CreateSetInput): Promise<{ id: string; duplicate: boolean }>;
}

type MemoryWorkout = WorkoutSummary & { userId: string };

export class MemoryRepository implements WorkoutRepository {
  private readonly workouts = new Map<string, MemoryWorkout>();
  private readonly mutations = new Set<string>();

  async listExercises() {
    return catalog;
  }

  async listWorkouts(userId: string) {
    return [...this.workouts.values()]
      .filter((workout) => workout.userId === userId)
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }

  async createWorkout(userId: string, input: CreateWorkoutInput) {
    if (this.mutations.has(input.clientMutationId)) return { id: input.id, duplicate: true };

    this.mutations.add(input.clientMutationId);
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
    if (this.mutations.has(input.clientMutationId)) return { id: input.set.id, duplicate: true };
    const workout = this.workouts.get(input.workoutId);
    if (!workout || workout.userId !== userId) throw new Error('Workout not found');

    this.mutations.add(input.clientMutationId);
    workout.setCount += 1;
    return { id: input.set.id, duplicate: false };
  }
}

export class PostgresRepository implements WorkoutRepository {
  private readonly db;

  constructor(connectionString: string) {
    this.db = createDatabase(connectionString);
  }

  async initialize() {
    await this.db
      .insert(users)
      .values({ ...developmentUser, role: 'superadmin' })
      .onConflictDoNothing({ target: users.id });

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

  private async hasMutation(userId: string, mutationId: string) {
    const result = await this.db
      .select({ id: clientMutations.id })
      .from(clientMutations)
      .where(and(eq(clientMutations.userId, userId), eq(clientMutations.id, mutationId)))
      .limit(1);
    return result.length > 0;
  }
}
