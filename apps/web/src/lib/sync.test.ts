import 'fake-indexeddb/auto';

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SyncMutation } from '@mighty-cringe/contracts';

import { db } from './db';
import { flushOutbox, getSyncStatus } from './sync';

const measuredOn = '2026-07-22T06:00:00.000Z';
const measurementId = '60000000-0000-4000-8000-000000000001';
const mutation = {
  type: 'measurement.create',
  payload: {
    id: measurementId,
    clientMutationId: '61000000-0000-4000-8000-000000000001',
    measuredOn,
    isSelfMeasured: true,
    values: {
      heightCm: null,
      weightKg: 80,
      neckCm: null,
      chestCm: null,
      bicepsCm: null,
      thighLeftCm: null,
      thighRightCm: null,
      calfCm: null,
      waistCm: 90,
      bodyFatPercent: null,
      rfmSex: null,
    },
  },
} satisfies SyncMutation;

describe('durable sync status', () => {
  beforeEach(async () => {
    await db.transaction('rw', db.tables, async () => {
      await Promise.all(db.tables.map((table) => table.clear()));
    });
    vi.restoreAllMocks();
  });
  afterAll(async () => db.delete());

  it('acknowledges a queued offline measurement and records the successful sync time', async () => {
    await queueLocalMeasurement();
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(
        Response.json({
          entityType: 'measurement',
          entity: {
            id: measurementId,
            measuredOn,
            isSelfMeasured: true,
            values: mutation.payload.values,
            revision: 1,
            updatedAt: '2026-07-22T06:01:00.000Z',
          },
          duplicate: false,
        }),
      ),
    );

    await expect(flushOutbox()).resolves.toBe('success');

    expect(await db.outbox.count()).toBe(0);
    expect(await db.measurements.get(measurementId)).toMatchObject({
      revision: 1,
      syncState: 'synced',
    });
    expect(await db.meta.get('lastSuccessfulSyncAt')).toBeDefined();
    expect(getSyncStatus()).toEqual({ phase: 'idle', message: null });
  });

  it('keeps a failed mutation durable and exposes a retryable server error', async () => {
    await queueLocalMeasurement();
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 503 })),
    );

    await expect(flushOutbox()).resolves.toBe('retry');

    expect(await db.outbox.count()).toBe(1);
    expect(getSyncStatus()).toMatchObject({ phase: 'error' });
  });
});

async function queueLocalMeasurement() {
  await db.measurements.put({
    id: measurementId,
    measuredOn,
    isSelfMeasured: true,
    values: mutation.payload.values,
    revision: 0,
    updatedAt: measuredOn,
    syncState: 'pending',
    deleted: false,
  });
  await db.outbox.put({
    id: mutation.payload.clientMutationId,
    sequence: 1,
    createdAt: measuredOn,
    mutation,
  });
}
