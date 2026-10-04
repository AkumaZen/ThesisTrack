import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listRemovedValuations } from '$lib/valuation/server/savedValuationsStore';

/** Companies removed from the watchlist in the last 30 days and not added back. */
export const GET: RequestHandler = async () => json(await listRemovedValuations());
