import type { LocalSet, LocalWorkout } from './db';

const DAY_MS = 86_400_000;

export type WorkoutDay = {
  dateKey: string;
  workoutIds: string[];
  workoutCount: number;
  setCount: number;
  volumeKg: number;
  hasUnsyncedData: boolean;
};

export type StreakSummary = {
  current: number;
  best: number;
};

export type ExerciseProgressPoint = {
  dateKey: string;
  finishedAt: string;
  workoutId: string;
  setCount: number;
  topWeightKg: number;
  volumeKg: number;
  estimatedOneRepMaxKg: number;
  sourceSet: Pick<LocalSet, 'id' | 'weightKg' | 'reps' | 'rir'>;
};

export type CalendarDay = {
  dateKey: string;
  dayOfMonth: number;
  inMonth: boolean;
  isToday: boolean;
  workout: WorkoutDay | null;
};

export function estimateOneRepMax(set: Pick<LocalSet, 'weightKg' | 'reps' | 'rir'>): number {
  return set.weightKg * (1 + (set.reps + (set.rir ?? 0)) / 30);
}

export function dateKeyInTimeZone(value: string | Date, timeZone: string): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const part = (type: 'year' | 'month' | 'day') =>
    parts.find((candidate) => candidate.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export function buildWorkoutDays(
  workouts: LocalWorkout[],
  sets: LocalSet[],
  timeZone: string,
): WorkoutDay[] {
  const completed = workouts.filter(
    (workout): workout is LocalWorkout & { endedAt: string } => workout.endedAt !== null,
  );
  const completedById = new Map(completed.map((workout) => [workout.id, workout]));
  const days = new Map<string, WorkoutDay>();

  for (const workout of completed) {
    const dateKey = dateKeyInTimeZone(workout.endedAt, timeZone);
    const day = days.get(dateKey) ?? {
      dateKey,
      workoutIds: [],
      workoutCount: 0,
      setCount: 0,
      volumeKg: 0,
      hasUnsyncedData: false,
    };
    day.workoutIds.push(workout.id);
    day.workoutCount += 1;
    day.hasUnsyncedData ||= workout.syncState !== 'synced';
    days.set(dateKey, day);
  }

  for (const set of sets) {
    if (set.deleted) continue;
    const workout = completedById.get(set.workoutId);
    if (!workout) continue;
    const day = days.get(dateKeyInTimeZone(workout.endedAt, timeZone));
    if (!day) continue;
    day.setCount += 1;
    day.volumeKg += set.weightKg * set.reps;
    day.hasUnsyncedData ||= set.syncState !== 'synced';
  }

  return [...days.values()].sort((left, right) => left.dateKey.localeCompare(right.dateKey));
}

export function calculateStreaks(dayKeys: string[], todayKey: string): StreakSummary {
  const unique = [...new Set(dayKeys)].sort();
  if (unique.length === 0) return { current: 0, best: 0 };

  let best = 1;
  let running = 1;
  for (let index = 1; index < unique.length; index += 1) {
    if (daysBetween(unique[index - 1], unique[index]) === 1) {
      running += 1;
      best = Math.max(best, running);
    } else {
      running = 1;
    }
  }

  const latest = unique.at(-1)!;
  const distanceFromToday = daysBetween(latest, todayKey);
  if (distanceFromToday < 0 || distanceFromToday > 1) return { current: 0, best };

  let current = 1;
  for (let index = unique.length - 1; index > 0; index -= 1) {
    if (daysBetween(unique[index - 1], unique[index]) !== 1) break;
    current += 1;
  }
  return { current, best };
}

export function volumeForRecentDays(days: WorkoutDay[], todayKey: string, windowDays = 30): number {
  const firstIncluded = addDays(todayKey, -(windowDays - 1));
  return days
    .filter((day) => day.dateKey >= firstIncluded && day.dateKey <= todayKey)
    .reduce((total, day) => total + day.volumeKg, 0);
}

export function buildExerciseProgress(
  exerciseId: string,
  workouts: LocalWorkout[],
  sets: LocalSet[],
  timeZone: string,
): ExerciseProgressPoint[] {
  const completedById = new Map(
    workouts
      .filter((workout): workout is LocalWorkout & { endedAt: string } => workout.endedAt !== null)
      .map((workout) => [workout.id, workout]),
  );
  const grouped = new Map<string, LocalSet[]>();

  for (const set of sets) {
    if (set.deleted || set.exerciseId !== exerciseId || !completedById.has(set.workoutId)) continue;
    const workoutSets = grouped.get(set.workoutId) ?? [];
    workoutSets.push(set);
    grouped.set(set.workoutId, workoutSets);
  }

  return [...grouped.entries()]
    .map(([workoutId, workoutSets]) => {
      const workout = completedById.get(workoutId)!;
      const sourceSet = workoutSets.reduce((best, set) =>
        estimateOneRepMax(set) > estimateOneRepMax(best) ? set : best,
      );
      return {
        dateKey: dateKeyInTimeZone(workout.endedAt, timeZone),
        finishedAt: workout.endedAt,
        workoutId,
        setCount: workoutSets.length,
        topWeightKg: Math.max(...workoutSets.map((set) => set.weightKg)),
        volumeKg: workoutSets.reduce((total, set) => total + set.weightKg * set.reps, 0),
        estimatedOneRepMaxKg: estimateOneRepMax(sourceSet),
        sourceSet: {
          id: sourceSet.id,
          weightKg: sourceSet.weightKg,
          reps: sourceSet.reps,
          rir: sourceSet.rir,
        },
      };
    })
    .sort((left, right) => left.finishedAt.localeCompare(right.finishedAt));
}

export function buildCalendarMonth(
  monthKey: string,
  workoutDays: WorkoutDay[],
  todayKey: string,
): CalendarDay[] {
  const [year, month] = monthKey.split('-').map(Number);
  const first = `${year}-${pad(month)}-01`;
  const firstWeekday = new Date(`${first}T00:00:00Z`).getUTCDay();
  const leadingDays = (firstWeekday + 6) % 7;
  const gridStart = addDays(first, -leadingDays);
  const workoutsByDay = new Map(workoutDays.map((day) => [day.dateKey, day]));

  return Array.from({ length: 42 }, (_, index) => {
    const dateKey = addDays(gridStart, index);
    return {
      dateKey,
      dayOfMonth: Number(dateKey.slice(8, 10)),
      inMonth: dateKey.startsWith(`${year}-${pad(month)}-`),
      isToday: dateKey === todayKey,
      workout: workoutsByDay.get(dateKey) ?? null,
    };
  });
}

function daysBetween(earlier: string, later: string): number {
  return Math.round((dateKeyToUtc(later) - dateKeyToUtc(earlier)) / DAY_MS);
}

function addDays(dateKey: string, amount: number): string {
  return new Date(dateKeyToUtc(dateKey) + amount * DAY_MS).toISOString().slice(0, 10);
}

function dateKeyToUtc(dateKey: string): number {
  const [year, month, day] = dateKey.split('-').map(Number);
  return Date.UTC(year, month - 1, day);
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}
