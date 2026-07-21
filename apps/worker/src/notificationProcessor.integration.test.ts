import assert from 'node:assert/strict';
import test from 'node:test';

import postgres from 'postgres';

import { PostgresNotificationJobStore } from './notificationProcessor.js';

const databaseUrl = process.env.DATABASE_URL;

test(
  'PostgreSQL schedules and atomically claims durable notification jobs',
  { skip: !databaseUrl },
  async () => {
    const sql = postgres(databaseUrl!, { max: 1, prepare: false });
    const jobs = new PostgresNotificationJobStore(databaseUrl!);
    const userId = '87000000-0000-4000-8000-000000000001';
    const now = new Date('2026-07-22T10:00:00.000Z');
    try {
      await sql`delete from users where id = ${userId}`;
      await sql`
        insert into users (id, email, display_name)
        values (${userId}, 'push-worker-test@example.com', 'Push Worker Test')
      `;
      await sql`
        insert into notification_preferences (
          user_id, enabled, frequency, weekday, reminder_time,
          quiet_start, quiet_end, time_zone, next_reminder_at
        ) values (
          ${userId}, true, 'daily', 1, '19:00', '22:00', '08:00',
          'Asia/Almaty', ${new Date('2026-07-22T09:59:00.000Z')}
        )
      `;
      await sql`
        insert into push_subscriptions (id, user_id, endpoint, p256dh, auth)
        values (
          '88000000-0000-4000-8000-000000000001',
          ${userId},
          'https://push.example.test/integration',
          ${'p'.repeat(64)},
          ${'a'.repeat(32)}
        )
      `;

      assert.equal(await jobs.scheduleDue(now), 1);
      const claimed = await jobs.claim(now);
      assert.equal(claimed?.attempts, 1);
      assert.equal(claimed?.subscriptions[0]?.endpoint, 'https://push.example.test/integration');
      await jobs.confirm(claimed!.id);

      const rows = await sql<Array<{ status: string; nextReminderAt: Date }>>`
        select jobs.status, preferences.next_reminder_at as "nextReminderAt"
        from notification_jobs as jobs
        inner join notification_preferences as preferences on preferences.user_id = jobs.user_id
        where jobs.user_id = ${userId}
      `;
      assert.equal(rows[0]?.status, 'sent');
      assert.ok(rows[0]!.nextReminderAt > now);
    } finally {
      await jobs.close();
      await sql`delete from users where id = ${userId}`;
      await sql.end();
    }
  },
);
