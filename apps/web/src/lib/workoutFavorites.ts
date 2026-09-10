import { db, type LocalWorkout } from './db';
import { flushOutbox, queueMutation } from './sync';

export const workoutFavoriteNameMaxLength = 60;

export function normalizeWorkoutFavoriteName(value: string) {
  return value.trim() || null;
}

export async function saveWorkoutFavorite(
  workout: LocalWorkout,
  isFavorite: boolean,
  favoriteName: string | null = workout.favoriteName,
) {
  const normalizedName = normalizeWorkoutFavoriteName(favoriteName ?? '');
  if (
    workout.endedAt === null ||
    (workout.isFavorite === isFavorite && workout.favoriteName === normalizedName)
  )
    return;
  await db.transaction('rw', db.workouts, db.outbox, async () => {
    await db.workouts.update(workout.id, {
      isFavorite,
      favoriteName: normalizedName,
      syncState: 'pending',
    });
    await queueMutation({
      type: 'workout.update',
      payload: {
        clientMutationId: crypto.randomUUID(),
        workoutId: workout.id,
        baseRevision: workout.revision,
        changes: { isFavorite, favoriteName: normalizedName },
      },
    });
  });
  await flushOutbox();
}
