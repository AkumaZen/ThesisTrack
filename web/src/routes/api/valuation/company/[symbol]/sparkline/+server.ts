import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSparklineCloses } from '$lib/server/sparklineCache';

// Lightweight endpoint for the watchlist screener's trend sparkline — just closing prices,
// not the full candle/OHLCV payload stage-analysis needs. Cached (see sparklineCache.ts) so
// repeat loads across rows/users/navigations don't re-hit Angel One's paced API every time.
export const GET: RequestHandler = async ({ params }) => {
	try {
		const closes = await getSparklineCloses(params.symbol);
		if (!closes) {
			error(404, `${params.symbol} isn't listed on Angel One (NSE equity only).`);
		}
		return json({ closes });
	} catch (e) {
		if (e && typeof e === 'object' && 'status' in e) throw e; // already a SvelteKit error()
		const message = e instanceof Error ? e.message : 'Unknown error';
		if (message === 'ANGEL_CREDENTIALS_MISSING') {
			error(500, 'Angel One API credentials are not configured on the server.');
		}
		error(502, message);
	}
};
