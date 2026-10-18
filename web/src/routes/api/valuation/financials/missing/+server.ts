import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { symbolsMissingFinancials } from '$lib/valuation/server/fundamentalStore';

// Scanner-universe tickers with no stored Screener statements: the plan for "Load missing
// financials", which then posts them to ./batch (an access-checked write). Reading changes nothing.
export const GET: RequestHandler = async () => json({ symbols: await symbolsMissingFinancials() });
