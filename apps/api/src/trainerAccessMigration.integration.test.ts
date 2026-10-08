import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createDatabase } from '@mighty-cringe/db';

const databaseUrl = process.env.DATABASE_URL;

test(
  'migration 0018 upgrades only active legacy links, preserves identifiers, and rejects old access downgrades',
  { skip: databaseUrl ? false : 'DATABASE_URL is not configured' },
  async (t) => {
    assert.ok(databaseUrl);
    const database = createDatabase(databaseUrl);
    t.after(() => database.$client.end());
    const schema = `trainer_access_test_${randomUUID().replaceAll('-', '')}`;
    const migration = await readFile(
      new URL('../../../packages/db/drizzle/0018_mysterious_kid_colt.sql', import.meta.url),
      'utf8',
    );
    const before = JSON.parse(
      await readFile(
        new URL('../../../packages/db/drizzle/meta/0017_snapshot.json', import.meta.url),
        'utf8',
      ),
    );
    const legacyTable = before.tables['public.trainer_athlete_links'];
    assert.equal(legacyTable.columns.access.default, "'read'");
    assert.deepEqual(legacyTable.checkConstraints, {});
    const activeId = randomUUID();
    const inactiveId = randomUUID();
    const currentId = randomUUID();
    const createdAt = new Date('2026-09-01T12:00:00.000Z');
    const revokedAt = new Date('2026-10-01T12:00:00.000Z');
    await database.$client.begin(async (transaction) => {
      await transaction.unsafe(`CREATE SCHEMA "${schema}"`);
      await transaction.unsafe(`SET LOCAL search_path TO "${schema}", public`);
      // Isolate a table matching the access-related 0017 shape; this never rewrites application rows.
      await transaction.unsafe(`CREATE TABLE trainer_athlete_links (
      id uuid PRIMARY KEY, trainer_id uuid NOT NULL, athlete_id uuid NOT NULL,
      active boolean NOT NULL DEFAULT true, access public.trainer_access NOT NULL DEFAULT 'read',
      access_changed_at timestamptz, revoked_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
    )`);
      await transaction`INSERT INTO trainer_athlete_links (id, trainer_id, athlete_id, active, access, revoked_at, created_at)
      VALUES (${activeId}, ${randomUUID()}, ${randomUUID()}, true, 'read', null, ${createdAt.toISOString()}),
      (${inactiveId}, ${randomUUID()}, ${randomUUID()}, false, 'read', ${revokedAt.toISOString()}, ${createdAt.toISOString()}),
      (${currentId}, ${randomUUID()}, ${randomUUID()}, true, 'manage', null, ${createdAt.toISOString()})`;
      for (const statement of migration.split('--> statement-breakpoint'))
        await transaction.unsafe(statement);
      const records = await transaction`SELECT * FROM trainer_athlete_links ORDER BY id`;
      assert.equal(records.length, 3);
      const active = records.find((row) => row.id === activeId)!;
      assert.equal(active.access, 'manage');
      assert.equal(active.active, true);
      assert.equal(new Date(active.created_at).toISOString(), createdAt.toISOString());
      assert.equal(active.access_changed_at, null);
      const inactive = records.find((row) => row.id === inactiveId)!;
      assert.equal(inactive.access, 'read');
      assert.equal(inactive.active, false);
      assert.equal(new Date(inactive.revoked_at).toISOString(), revokedAt.toISOString());
      assert.equal(records.find((row) => row.id === currentId)?.access, 'manage');
      const inserted =
        await transaction`INSERT INTO trainer_athlete_links (id, trainer_id, athlete_id)
      VALUES (${randomUUID()}, ${randomUUID()}, ${randomUUID()}) RETURNING access`;
      assert.equal(inserted[0].access, 'manage');
      // A cached/rolling old API cannot report a successful read-only downgrade after migration.
      const replacedId = randomUUID();
      await assert.rejects(
        transaction.savepoint(async (savepoint) => {
          await savepoint`UPDATE trainer_athlete_links SET id = ${replacedId}, access = 'read' WHERE id = ${activeId}`;
        }),
        (error: unknown) =>
          Boolean(error && typeof error === 'object' && 'code' in error && error.code === '23514'),
      );
      await assert.rejects(
        transaction.savepoint(async (savepoint) => {
          await savepoint`INSERT INTO trainer_athlete_links (id, trainer_id, athlete_id, access)
        VALUES (${randomUUID()}, ${randomUUID()}, ${randomUUID()}, 'read')`;
        }),
        (error: unknown) =>
          Boolean(error && typeof error === 'object' && 'code' in error && error.code === '23514'),
      );
      const preserved =
        await transaction`SELECT id, access FROM trainer_athlete_links WHERE id IN (${activeId}, ${replacedId})`;
      assert.equal(preserved.length, 1);
      assert.equal(preserved[0].id, activeId);
      assert.equal(preserved[0].access, 'manage');
      await transaction.unsafe(`DROP SCHEMA "${schema}" CASCADE`);
    });
  },
);
