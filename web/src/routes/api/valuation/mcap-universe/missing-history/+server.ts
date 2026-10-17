import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listUniverseSymbolsWithoutSeries } from '$lib/valuation/server/mcapUniverseStore';

// The market cap list's tickers that have no stored prices: the plan for the scanner's "Load
// missing history" button, which then posts them to refresh-batch (an access-checked write).
// Reading the list changes nothing, so it is a plain GET.
export const GET: RequestHandler = async () => {
	return json({ symbols: await listUniverseSymbolsWithoutSeries() });
};
