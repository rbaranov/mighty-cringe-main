import type { SyncMutation } from '@mighty-cringe/contracts';

import { db, type OutboxMutation } from './db';

export async function queueMutation(mutation: SyncMutation) {
  const id =
    mutation.type === 'workout.create'
      ? mutation.payload.clientMutationId
      : mutation.payload.clientMutationId;
  await db.outbox.put({ id, createdAt: new Date().toISOString(), mutation });
}

export async function flushOutbox() {
  if (!navigator.onLine) return;
  const mutations = await db.outbox.orderBy('createdAt').toArray();

  for (const queued of mutations) {
    const response = await fetch('/api/v1/sync', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(queued.mutation),
    });
    if (!response.ok) return;
    await markSynced(queued);
    await db.outbox.delete(queued.id);
  }
}

async function markSynced(queued: OutboxMutation) {
  if (queued.mutation.type === 'workout.create') {
    await db.workouts.update(queued.mutation.payload.id, { syncState: 'synced' });
    return;
  }
  await db.sets.update(queued.mutation.payload.set.id, { syncState: 'synced' });
}
