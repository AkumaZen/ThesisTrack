import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { readCachedSeries } from '$lib/valuation/server/companyGrowthSeries';

// The stored daily closes for one company (about 700 calendar days) - backs a company card in a
// subsector. Reads what is stored and never calls Angel One; prices are refreshed on the daily
// schedule or by the card's Refresh button (see ../refresh-series). Separate from /sparkline
// (90 days, watchlist-tuned).
export const GET: RequestHandler = async ({ params }) => {
	const stored = await readCachedSeries(params.symbol);
	if (!stored) error(404, `No stored prices for ${params.symbol.toUpperCase()} yet.`);
	return json({ closes: stored.candles.map((c) => c.close), fetchedAt: stored.fetchedAt });
};
