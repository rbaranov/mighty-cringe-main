import type { ExercisePreferenceValue } from '@mighty-cringe/contracts';

import { getDataContext } from './dataContext';
import { flushOutbox, queueMutation } from './sync';

export async function toggleExercisePreference(
  exerciseId: string,
  selectedValue: ExercisePreferenceValue,
  context = getDataContext(),
) {
  const db = context.database;
  const current = await db.exercisePreferences.get(exerciseId);
  const value = current?.value === selectedValue ? null : selectedValue;
  const updatedAt = new Date().toISOString();
  await db.transaction('rw', db.exercisePreferences, db.outbox, async () => {
    await db.exercisePreferences.put({
      exerciseId,
      value,
      revision: current?.revision ?? 0,
      updatedAt,
      syncState: 'pending',
    });
    await queueMutation(
      {
        type: 'exercise-preference.set',
        payload: {
          clientMutationId: crypto.randomUUID(),
          exerciseId,
          value,
          baseRevision: current?.revision ?? 0,
        },
      },
      context,
    );
  });
  void flushOutbox(context);
}
