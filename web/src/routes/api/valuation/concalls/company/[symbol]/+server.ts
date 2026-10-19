import { error, json } from '@sveltejs/kit';
import { companyPanel } from '$lib/valuation/server/concallPanel';
import type { RequestHandler } from './$types';

/** The data behind the per-company concall and red-flag panel. Stored data only: never fetches or calls a model. */
export const GET: RequestHandler = async ({ params }) => {
	const panel = await companyPanel(params.symbol.toUpperCase());
	if (!panel) error(404, 'This company is not in the Master Tracker.');
	return json(panel);
};
