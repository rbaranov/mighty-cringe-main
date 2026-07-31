import { db, type LocalWorkout } from './db';
import { flushOutbox, queueMutation } from './sync';

export async function saveWorkoutFavorite(workout: LocalWorkout, isFavorite: boolean) {
  if (workout.endedAt === null || workout.isFavorite === isFavorite) return;
  await db.transaction('rw', db.workouts, db.outbox, async () => {
    await db.workouts.update(workout.id, { isFavorite, syncState: 'pending' });
    await queueMutation({
      type: 'workout.update',
      payload: {
        clientMutationId: crypto.randomUUID(),
        workoutId: workout.id,
        baseRevision: workout.revision,
        changes: { isFavorite },
      },
    });
  });
  await flushOutbox();
}
