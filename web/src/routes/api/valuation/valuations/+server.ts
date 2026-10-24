import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listSavedValuationRows } from '$lib/valuation/server/savedValuationsStore';
import { showcaseOnly } from '$lib/server/showcase';
import { isGuest } from '$lib/guest';

export const GET: RequestHandler = async ({ locals }) => {
	const rows = await showcaseOnly(await listSavedValuationRows(), isGuest(locals.user));
	return json(rows);
};
