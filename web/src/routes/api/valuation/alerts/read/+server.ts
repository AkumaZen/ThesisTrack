import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { setRead, unreadCount } from '$lib/valuation/server/alertStore';

/** Body: { read: boolean, ids?: number[] } or { read: boolean, all: true }. */
export const POST: RequestHandler = async ({ request, locals }) => {
	const body = (await request.json().catch(() => null)) as {
		read?: unknown;
		ids?: unknown;
		all?: unknown;
	} | null;
	if (!body || typeof body.read !== 'boolean') error(400, '"read" must be true or false.');

	if (body.all === true) {
		await setRead(locals.user!.id, { all: true, read: body.read });
	} else if (
		Array.isArray(body.ids) &&
		body.ids.length > 0 &&
		body.ids.every((n) => Number.isInteger(n))
	) {
		await setRead(locals.user!.id, { ids: body.ids as number[], read: body.read });
	} else {
		error(400, 'Provide "ids" (integers) or "all": true.');
	}
	return json({ unread: await unreadCount(locals.user!.id) });
};
