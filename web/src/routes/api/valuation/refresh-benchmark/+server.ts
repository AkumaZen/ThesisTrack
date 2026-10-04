import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { refreshBenchmarkCandles } from '$lib/valuation/server/benchmarkSeries';

// Fetches the Nifty 50 again (relative strength is measured against it). Called once at the end of
// a Refresh, after the companies' own prices.
export const POST: RequestHandler = async () => {
	try {
		const candles = await refreshBenchmarkCandles();
		return json({ sessions: candles.length });
	} catch (e) {
		const message = e instanceof Error ? e.message : 'Unknown error';
		error(message === 'ANGEL_CREDENTIALS_MISSING' ? 500 : 502, message);
	}
};
