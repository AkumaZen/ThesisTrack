import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listSavedValuationRows } from '$lib/valuation/server/savedValuationsStore';

export const GET: RequestHandler = async () => {
	const rows = await listSavedValuationRows();
	return json(rows);
};
