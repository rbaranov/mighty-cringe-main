import { describe, expect, it } from 'vitest';

import {
  getNotificationSettings,
  isReminderInsideQuietHours,
  updateNotificationPreferences,
  urlBase64ToUint8Array,
} from './notifications';

describe('notification settings', () => {
  it('recognizes overnight quiet hours', () => {
    expect(isReminderInsideQuietHours('23:00', '22:00', '08:00')).toBe(true);
    expect(isReminderInsideQuietHours('07:59', '22:00', '08:00')).toBe(true);
    expect(isReminderInsideQuietHours('19:00', '22:00', '08:00')).toBe(false);
  });

  it('decodes a URL-safe VAPID public key', () => {
    expect([...urlBase64ToUint8Array('AQID-_8')]).toEqual([1, 2, 3, 251, 255]);
  });

  it('loads config and preferences without requesting browser permission', async () => {
    const urls: string[] = [];
    const request = async (input: RequestInfo | URL) => {
      urls.push(String(input));
      const body = String(input).endsWith('/config')
        ? { enabled: true, publicKey: 'public' }
        : {
            preferences: {
              enabled: false,
              frequency: 'daily',
              weekday: 1,
              reminderTime: '19:00',
              quietStart: '22:00',
              quietEnd: '08:00',
              timeZone: 'UTC',
              nextReminderAt: null,
            },
          };
      return new Response(JSON.stringify(body), { status: 200 });
    };
    const settings = await getNotificationSettings(request as typeof fetch);
    expect(settings.preferences.enabled).toBe(false);
    expect(urls).toEqual(['/api/v1/notifications/config', '/api/v1/notifications/preferences']);
  });

  it('sends the complete schedule when it is saved', async () => {
    let body = '';
    const request = async (_input: RequestInfo | URL, init?: RequestInit) => {
      body = String(init?.body);
      return new Response(JSON.stringify({ preferences: JSON.parse(body) }), { status: 200 });
    };
    await updateNotificationPreferences(
      {
        enabled: true,
        frequency: 'weekly',
        weekday: 3,
        reminderTime: '19:00',
        quietStart: '22:00',
        quietEnd: '08:00',
        timeZone: 'Asia/Almaty',
      },
      request as typeof fetch,
    );
    expect(JSON.parse(body)).toMatchObject({ enabled: true, frequency: 'weekly', weekday: 3 });
  });
});
