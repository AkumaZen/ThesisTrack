import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { fetchDailyCandles } from '$lib/valuation/server/angelone';
import { buildPriceSeries } from '$lib/valuation/priceChart';

// About 700 calendar days (~480 sessions) so the 200-day average is complete across a full
// 252-session chart. Cached briefly in memory: the page asks once per visit.
const DAYS = 700;
const TTL_MS = 10 * 60 * 1000;
const cache = new Map<string, { at: number; body: unknown }>();

export const GET: RequestHandler = async ({ params }) => {
	const symbol = params.symbol.toUpperCase();
	const hit = cache.get(symbol);
	if (hit && Date.now() - hit.at < TTL_MS) return json(hit.body);

	try {
		const candles = await fetchDailyCandles(symbol, DAYS);
		if (!candles)
			error(404, `${symbol} isn't listed on Angel One (NSE equity only), so there is no price history.`);
		if (candles.length < 10) error(502, `Not enough price history returned for ${symbol}.`);
		const points = buildPriceSeries(candles, 252);
		const body = { symbol, sessionsFetched: candles.length, points };
		cache.set(symbol, { at: Date.now(), body });
		return json(body);
	} catch (e) {
		if (e && typeof e === 'object' && 'status' in e) throw e; // already a SvelteKit error()
		const message = e instanceof Error ? e.message : 'Unknown error';
		if (message === 'ANGEL_CREDENTIALS_MISSING')
			error(500, 'Angel One API credentials are not configured on the server.');
		error(502, message);
	}
};
