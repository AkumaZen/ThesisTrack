// ThesisTrack service worker: only shows announcement push notifications and handles taps on them.
// It does no caching, so it can never serve a stale app.

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
	let data = {};
	try {
		data = event.data ? event.data.json() : {};
	} catch {
		data = { body: event.data ? event.data.text() : '' };
	}
	const title = data.title || 'ThesisTrack';
	event.waitUntil(
		self.registration.showNotification(title, {
			body: data.body || '',
			icon: '/icon-192.png',
			badge: '/icon-192.png',
			tag: data.tag,
			data: { url: data.url || '/valuation/tracking' }
		})
	);
});

self.addEventListener('notificationclick', (event) => {
	event.notification.close();
	const target = new URL(event.notification.data?.url || '/valuation/tracking', self.location.origin).href;
	event.waitUntil(
		self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
			for (const client of windows) {
				if (new URL(client.url).origin === self.location.origin && 'focus' in client) {
					return client.focus().then((c) => ('navigate' in c ? c.navigate(target) : c));
				}
			}
			return self.clients.openWindow(target);
		})
	);
});
