import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getPrefs, updatePrefs } from '$lib/server/prefsStore';

/** The signed-in user's own preferences (columns, sort, view, sector card metrics). */
export const GET: RequestHandler = async ({ locals }) => json(await getPrefs(locals.user!.id));

/** Body: a partial preferences object; invalid values fall back to defaults. Returns the result. */
export const PUT: RequestHandler = async ({ locals, request }) => {
	const patch = await request.json().catch(() => null);
	return json(await updatePrefs(locals.user!.id, patch));
};
