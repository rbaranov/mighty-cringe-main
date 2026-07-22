import type {
  NotificationPreferences,
  PushSubscriptionInput,
  UpdateNotificationPreferences,
} from '@mighty-cringe/contracts';

type Request = typeof fetch;

export type NotificationConfig = { enabled: boolean; publicKey: string | null };

export async function getNotificationSettings(request: Request = fetch) {
  const [config, preferences] = await Promise.all([
    requestJson<NotificationConfig>('/api/v1/notifications/config', request),
    requestJson<{ preferences: NotificationPreferences }>(
      '/api/v1/notifications/preferences',
      request,
    ),
  ]);
  return { config, preferences: preferences.preferences };
}

export async function updateNotificationPreferences(
  preferences: UpdateNotificationPreferences,
  request: Request = fetch,
) {
  return requestJson<{ preferences: NotificationPreferences }>(
    '/api/v1/notifications/preferences',
    request,
    { method: 'PATCH', body: JSON.stringify(preferences) },
  );
}

export function pushIsSupported() {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

export async function subscribeToPush(publicKey: string, request: Request = fetch) {
  if (!pushIsSupported()) throw new Error('Этот браузер не поддерживает push-уведомления.');
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    throw new Error('Разрешение не выдано. Его можно изменить в настройках браузера.');
  }
  const registration = await navigator.serviceWorker.ready;
  const subscription =
    (await registration.pushManager.getSubscription()) ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    }));
  const body = subscription.toJSON() as PushSubscriptionInput;
  await requestJson('/api/v1/notifications/subscriptions', request, {
    method: 'POST',
    body: JSON.stringify(body),
  });
  return subscription;
}

export async function unsubscribeFromPush(request: Request = fetch) {
  if (!pushIsSupported()) return;
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) return;
  const response = await request('/api/v1/notifications/subscriptions', {
    method: 'DELETE',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ endpoint: subscription.endpoint }),
  });
  if (!response.ok) throw await notificationRequestError(response);
  await subscription.unsubscribe();
}

export function isReminderInsideQuietHours(
  reminderTime: string,
  quietStart: string,
  quietEnd: string,
) {
  if (quietStart === quietEnd) return false;
  if (quietStart < quietEnd) return reminderTime >= quietStart && reminderTime < quietEnd;
  return reminderTime >= quietStart || reminderTime < quietEnd;
}

export function urlBase64ToUint8Array(value: string) {
  const padding = '='.repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  return Uint8Array.from(raw, (character) => character.charCodeAt(0));
}

async function requestJson<T>(url: string, request: Request, init: RequestInit = {}) {
  const response = await request(url, {
    credentials: 'include',
    headers: { 'content-type': 'application/json', ...init.headers },
    ...init,
  });
  if (!response.ok) throw await notificationRequestError(response);
  return (await response.json()) as T;
}

async function notificationRequestError(response: Response) {
  const payload = (await response.json().catch(() => null)) as { error?: unknown } | null;
  return new Error(
    typeof payload?.error === 'string' ? payload.error : 'Не удалось сохранить напоминания.',
  );
}
