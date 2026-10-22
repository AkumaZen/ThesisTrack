import { json } from '@sveltejs/kit';
import { companyPanel } from '$lib/valuation/server/concallPanel';
import type { RequestHandler } from './$types';

/** The data behind the per-company concall and red-flag panel. Stored data only: never fetches or calls a model. */
export const GET: RequestHandler = async ({ params }) => {
	const panel = await companyPanel(params.symbol.toUpperCase());
	// A company outside the Master Tracker is a normal case, not an error: null means "nothing to show".
	return json(panel);
};
