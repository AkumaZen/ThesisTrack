import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { removeSubscription, saveSubscription } from '$lib/valuation/server/announcementStore';

export const POST: RequestHandler = async ({ request, locals }) => {
	const b = (await request.json().catch(() => null)) as {
		endpoint?: unknown;
		keys?: { p256dh?: unknown; auth?: unknown };
	} | null;
	const { endpoint } = b ?? {};
	const p256dh = b?.keys?.p256dh;
	const auth = b?.keys?.auth;
	if (typeof endpoint !== 'string' || !/^https:\/\//.test(endpoint) || typeof p256dh !== 'string' || typeof auth !== 'string' || !p256dh || !auth) {
		error(400, 'That is not a valid push subscription.');
	}
	await saveSubscription(locals.user!.id, { endpoint, p256dh, auth });
	return json({ ok: true });
};

export const DELETE: RequestHandler = async ({ request, locals }) => {
	const b = (await request.json().catch(() => null)) as { endpoint?: unknown } | null;
	if (typeof b?.endpoint !== 'string') error(400, 'Say which subscription to remove.');
	await removeSubscription(locals.user!.id, b.endpoint);
	return json({ ok: true });
};
