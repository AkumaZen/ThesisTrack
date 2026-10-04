import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listActivity } from '$lib/valuation/server/activityStore';

/** The team activity feed, newest first. ?limit (1-200, default 30), ?before=<timestamp> to page
 *  back, ?symbol= for one company, ?others=1 to leave out the signed-in user's own actions. */
export const GET: RequestHandler = async ({ url, locals }) => {
	const limit = Number(url.searchParams.get('limit') ?? 30);
	if (!Number.isInteger(limit) || limit < 1 || limit > 200) error(400, '"limit" must be 1-200.');
	const beforeRaw = url.searchParams.get('before');
	const before = beforeRaw === null ? undefined : Number(beforeRaw);
	if (before !== undefined && !Number.isFinite(before)) error(400, '"before" must be a timestamp.');
	return json(
		await listActivity({
			limit,
			before,
			symbol: url.searchParams.get('symbol') ?? undefined,
			excludeActor: url.searchParams.get('others') === '1' ? locals.user!.username : undefined
		})
	);
};
