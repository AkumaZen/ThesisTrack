import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listValuationHistory } from '$lib/server/savedValuationsStore';

/** Every version of this company's valuation, newest first, each with what it changed. */
export const GET: RequestHandler = async ({ params }) =>
	json(await listValuationHistory(params.symbol));
