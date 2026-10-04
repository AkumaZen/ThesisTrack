import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getCompanySeries } from '$lib/server/companyGrowthSeries';

// ~400 calendar days of closes for one company — backs the sector constituent drill-down
// page's per-company chart/growth panel. Separate from /sparkline (90 days, watchlist-tuned).
export const GET: RequestHandler = async ({ params }) => {
	try {
		const candles = await getCompanySeries(params.symbol);
		if (!candles) {
			error(404, `${params.symbol} isn't listed on Angel One (NSE equity only).`);
		}
		return json({ closes: candles.map((c) => c.close) });
	} catch (e) {
		if (e && typeof e === 'object' && 'status' in e) throw e; // already a SvelteKit error()
		const message = e instanceof Error ? e.message : 'Unknown error';
		if (message === 'ANGEL_CREDENTIALS_MISSING') {
			error(500, 'Angel One API credentials are not configured on the server.');
		}
		error(502, message);
	}
};
