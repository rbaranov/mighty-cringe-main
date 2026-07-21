import webPush from 'web-push';

import type {
  NotificationPreferences,
  PushSubscriptionInput,
  UpdateNotificationPreferences,
} from '@mighty-cringe/contracts';

export type NotificationPayload = {
  title: string;
  body: string;
  url: string;
};

export type PushEnvironment = Record<string, string | undefined>;

export interface PushSender {
  send(subscription: PushSubscriptionInput, payload: NotificationPayload): Promise<void>;
}

export class PushDeliveryError extends Error {
  constructor(
    message: string,
    readonly statusCode: number | null,
  ) {
    super(message);
  }

  get expired() {
    return this.statusCode === 404 || this.statusCode === 410;
  }

  get retryable() {
    return (
      this.statusCode === null ||
      this.statusCode === 408 ||
      this.statusCode === 429 ||
      this.statusCode >= 500
    );
  }
}

export function pushPublicKeyFromEnvironment(environment: PushEnvironment) {
  return environment.VAPID_PUBLIC_KEY?.trim() || null;
}

export function pushSenderFromEnvironment(environment: PushEnvironment): PushSender | null {
  const subject = environment.VAPID_SUBJECT?.trim();
  const publicKey = environment.VAPID_PUBLIC_KEY?.trim();
  const privateKey = environment.VAPID_PRIVATE_KEY?.trim();
  const configured = [subject, publicKey, privateKey].filter(Boolean).length;
  if (configured === 0) return null;
  if (!subject || !publicKey || !privateKey) {
    throw new Error(
      'VAPID_SUBJECT, VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY must be configured together',
    );
  }

  return {
    async send(subscription, payload) {
      try {
        await webPush.sendNotification(subscription, JSON.stringify(payload), {
          TTL: 60 * 60,
          urgency: 'normal',
          topic: 'workout-reminder',
          vapidDetails: { subject, publicKey, privateKey },
        });
      } catch (error) {
        const details = error as { message?: unknown; statusCode?: unknown };
        throw new PushDeliveryError(
          typeof details.message === 'string' ? details.message : 'Push provider rejected delivery',
          typeof details.statusCode === 'number' ? details.statusCode : null,
        );
      }
    },
  };
}

export function isValidTimeZone(timeZone: string) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format();
    return true;
  } catch {
    return false;
  }
}

export function isQuietTime(time: string, quietStart: string, quietEnd: string) {
  if (quietStart === quietEnd) return false;
  if (quietStart < quietEnd) return time >= quietStart && time < quietEnd;
  return time >= quietStart || time < quietEnd;
}

export function nextNotificationAt(
  preferences: Pick<
    UpdateNotificationPreferences | NotificationPreferences,
    'frequency' | 'weekday' | 'reminderTime' | 'quietStart' | 'quietEnd' | 'timeZone'
  >,
  after: Date,
) {
  if (!isValidTimeZone(preferences.timeZone)) throw new Error('Invalid IANA time zone');
  if (isQuietTime(preferences.reminderTime, preferences.quietStart, preferences.quietEnd)) {
    throw new Error('Reminder time must be outside quiet hours');
  }

  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: preferences.timeZone,
    hourCycle: 'h23',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
  const start = Math.floor(after.getTime() / 60_000) * 60_000 + 60_000;
  for (let offset = 0; offset < 15 * 24 * 60; offset += 1) {
    const candidate = new Date(start + offset * 60_000);
    const parts = Object.fromEntries(
      formatter.formatToParts(candidate).map((part) => [part.type, part.value]),
    );
    if (`${parts.hour}:${parts.minute}` !== preferences.reminderTime) continue;
    const weekday = weekdayNumber(parts.weekday);
    const eligible =
      preferences.frequency === 'daily' ||
      (preferences.frequency === 'weekdays' && weekday >= 1 && weekday <= 5) ||
      (preferences.frequency === 'weekly' && weekday === preferences.weekday);
    if (eligible) return candidate;
  }
  throw new Error('Could not calculate the next notification time');
}

function weekdayNumber(shortName: string | undefined) {
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(shortName ?? '');
  if (weekday < 0) throw new Error('Could not calculate the local weekday');
  return weekday;
}
