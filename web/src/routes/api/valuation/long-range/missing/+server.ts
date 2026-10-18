import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { symbolsMissingLongRange } from '$lib/valuation/server/longRangeStore';

// Scanner-universe tickers with no stored 5-year high: the plan for "Load 5-year highs", which then
// posts them to ./batch (an access-checked write). Reading changes nothing.
export const GET: RequestHandler = async () => json({ symbols: await symbolsMissingLongRange() });
