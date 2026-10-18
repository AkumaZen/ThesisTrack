// Browser side of announcement alerts: registering the service worker, asking for permission and
// sending the device's push subscription to the server. Permission can only be requested from a
// user gesture, so enablePush() is called from a button click.
import { sectorApi } from '$lib/valuation/sectorClient';

export const pushSupported = () =>
	typeof window !== 'undefined' &&
	'serviceWorker' in navigator &&
	'PushManager' in window &&
	'Notification' in window;

function keyBytes(base64Url: string): Uint8Array<ArrayBuffer> {
	const base64 = (base64Url + '='.repeat((4 - (base64Url.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
	const raw = atob(base64);
	return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

export async function pushConfig(): Promise<{ configured: boolean; publicKey: string | null }> {
	try {
		const res = await fetch('/api/valuation/push/config');
		if (res.ok) return await res.json();
	} catch {
		// fall through: treated as not configured
	}
	return { configured: false, publicKey: null };
}

async function subscribeAndSave(publicKey: string): Promise<{ ok: true } | { ok: false; message: string }> {
	const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
	await navigator.serviceWorker.ready;
	const subscription =
		(await registration.pushManager.getSubscription()) ??
		(await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) }));
	const saved = await sectorApi('POST', '/api/valuation/push/subscribe', subscription.toJSON());
	return saved.ok ? { ok: true } : { ok: false, message: saved.message };
}

/** Asks for permission (call from a click), then subscribes this device. */
export async function enablePush(): Promise<{ ok: true } | { ok: false; message: string }> {
	if (!pushSupported()) return { ok: false, message: 'This browser does not support push notifications.' };
	const config = await pushConfig();
	if (!config.configured || !config.publicKey) {
		return { ok: false, message: 'Notifications are not set up on the server yet.' };
	}
	const permission = await Notification.requestPermission();
	if (permission !== 'granted') {
		return {
			ok: false,
			message: 'Notifications were not allowed. Allow them in the browser site settings to get alerts.'
		};
	}
	try {
		return await subscribeAndSave(config.publicKey);
	} catch {
		return { ok: false, message: 'Could not subscribe this device. Try again.' };
	}
}

/** Already allowed: make sure the server still knows this device (it may have been cleared). */
export async function syncSubscription(): Promise<void> {
	if (!pushSupported() || Notification.permission !== 'granted') return;
	const config = await pushConfig();
	if (!config.configured || !config.publicKey) return;
	try {
		await subscribeAndSave(config.publicKey);
	} catch {
		// Best effort; the tracking page shows the state and offers Allow again.
	}
}
