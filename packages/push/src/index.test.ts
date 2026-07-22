import assert from 'node:assert/strict';
import test from 'node:test';

import { isQuietTime, nextNotificationAt, pushSenderFromEnvironment } from './index.js';

const base = {
  enabled: true,
  frequency: 'daily' as const,
  weekday: 1,
  reminderTime: '19:00',
  quietStart: '22:00',
  quietEnd: '08:00',
  timeZone: 'Asia/Almaty',
};

test('calculates the next reminder in the user time zone', () => {
  assert.equal(
    nextNotificationAt(base, new Date('2026-07-22T10:00:00.000Z')).toISOString(),
    '2026-07-22T14:00:00.000Z',
  );
});

test('skips weekends and respects the chosen weekly day', () => {
  assert.equal(
    nextNotificationAt(
      { ...base, frequency: 'weekdays' },
      new Date('2026-07-24T15:00:00.000Z'),
    ).toISOString(),
    '2026-07-27T14:00:00.000Z',
  );
  assert.equal(
    nextNotificationAt(
      { ...base, frequency: 'weekly', weekday: 3 },
      new Date('2026-07-22T15:00:00.000Z'),
    ).toISOString(),
    '2026-07-29T14:00:00.000Z',
  );
});

test('recognizes overnight quiet hours and rejects a reminder inside them', () => {
  assert.equal(isQuietTime('23:00', '22:00', '08:00'), true);
  assert.equal(isQuietTime('12:00', '22:00', '08:00'), false);
  assert.throws(
    () => nextNotificationAt({ ...base, reminderTime: '23:00' }, new Date()),
    /outside quiet hours/,
  );
});

test('requires the complete server-only VAPID configuration', () => {
  assert.equal(pushSenderFromEnvironment({}), null);
  assert.throws(
    () => pushSenderFromEnvironment({ VAPID_PUBLIC_KEY: 'public' }),
    /must be configured together/,
  );
});
