import { db, type LocalWorkout } from './db';
import { flushOutbox, queueMutation } from './sync';

export const workoutNotesMaxLength = 10_000;

export async function saveWorkoutNotes(workout: LocalWorkout, draft: string) {
  const notes = draft.trim() || null;
  if (notes === workout.notes) return;

  const activityAt = new Date().toISOString();
  const changes = {
    notes,
    ...(workout.endedAt === null ? { lastActivityAt: activityAt } : {}),
  };

  await db.transaction('rw', db.workouts, db.outbox, async () => {
    await db.workouts.update(workout.id, { ...changes, syncState: 'pending' });
    await queueMutation({
      type: 'workout.update',
      payload: {
        clientMutationId: crypto.randomUUID(),
        workoutId: workout.id,
        baseRevision: workout.revision,
        changes,
        activityAt,
      },
    });
  });
  await flushOutbox();
}
