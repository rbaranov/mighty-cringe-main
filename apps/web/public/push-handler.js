self.addEventListener('push', (event) => {
  let payload = {
    title: 'MightyCringe',
    body: 'Пора заглянуть в тренировочный план.',
    url: '/',
  };
  try {
    if (event.data) payload = { ...payload, ...event.data.json() };
  } catch {
    // Keep the privacy-safe fallback when a provider sends a malformed payload.
  }
  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      data: { url: payload.url },
      icon: '/favicon.svg',
      badge: '/favicon.svg',
      tag: 'workout-reminder',
      renotify: true,
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || '/', self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      const existing = clients.find((client) => client.url.startsWith(self.location.origin));
      if (existing) {
        void existing.focus();
        return existing.navigate(target);
      }
      return self.clients.openWindow(target);
    }),
  );
});
