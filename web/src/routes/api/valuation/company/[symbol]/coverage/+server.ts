import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getCoverage, setCoverage } from '$lib/valuation/server/teamStore';

/**
 * Body: { userId: number | null }. Anyone may take a company themselves or let go of their own;
 * assigning it to someone else, or taking it from someone else, is for the admin.
 */
export const PUT: RequestHandler = async ({ params, request, locals }) => {
	const input = (await request.json().catch(() => null)) as { userId?: unknown } | null;
	const userId = input?.userId;
	if (userId !== null && !(typeof userId === 'number' && Number.isInteger(userId) && userId > 0)) {
		error(400, '"userId" must be a user id or null.');
	}
	const me = locals.user!;
	if (me.role !== 'admin') {
		const current = await getCoverage(params.symbol);
		const touchesOthers =
			(userId !== null && userId !== me.id) || (current !== null && current.userId !== me.id);
		if (touchesOthers) {
			error(403, 'Only the admin can assign a company to someone else or reassign it.');
		}
	}
	const result = await setCoverage(params.symbol, userId as number | null, me.username);
	if (result === false) error(400, 'No such user.');
	return json({ coverage: result });
};
