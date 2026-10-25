// Web Push receiver. Payload from the API: { title, body, url? } (see apps/api push.service.ts).
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let msg = {};
  try {
    msg = event.data ? event.data.json() : {};
  } catch {
    msg = { title: 'Settled', body: event.data ? event.data.text() : '' };
  }
  event.waitUntil(
    self.registration.showNotification(msg.title || 'Settled', {
      body: msg.body || '',
      icon: '/logo-mark.svg',
      badge: '/logo-mark.svg',
      data: { url: msg.url || '/activity' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL((event.notification.data && event.notification.data.url) || '/', self.location.origin);
  // Only same-origin paths: the payload comes over the wire
  const url = target.origin === self.location.origin ? target.href : self.location.origin + '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((all) => {
      for (const c of all) {
        if (new URL(c.url).origin === self.location.origin && 'focus' in c) {
          return c.focus().then((f) => ('navigate' in f ? f.navigate(url) : undefined));
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
