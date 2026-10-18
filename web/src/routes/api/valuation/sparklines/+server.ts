import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { readCachedCloses } from '$lib/valuation/server/companyGrowthSeries';
import { sparklineTail } from '$lib/valuation/server/sparklineCache';

const MAX_SYMBOLS = 60;

// Recent closes for many tickers in ONE query, for the chart grid tiles. Stored prices only, never
// Angel One. A symbol with no stored prices is simply left out.
export const GET: RequestHandler = async ({ url }) => {
	const symbols = (url.searchParams.get('symbols') ?? '')
		.split(',')
		.map((s) => s.trim())
		.filter(Boolean);
	if (symbols.length === 0) error(400, 'symbols must be a non-empty list of tickers.');
	if (symbols.length > MAX_SYMBOLS) error(400, `At most ${MAX_SYMBOLS} symbols per request.`);
	try {
		const stored = await readCachedCloses(symbols);
		const series: Record<string, number[]> = {};
		for (const [symbol, s] of stored) {
			const closes = sparklineTail(s.closes);
			if (closes.length >= 2) series[symbol] = closes;
		}
		return json({ series });
	} catch (e) {
		error(502, e instanceof Error ? e.message : 'Unknown error');
	}
};
