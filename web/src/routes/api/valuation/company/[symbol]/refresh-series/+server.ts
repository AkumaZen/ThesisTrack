import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { refreshCompanySeries } from '$lib/valuation/server/companyGrowthSeries';

// Fetches fresh daily prices for one company from Angel One and stores them - what a card's
// Refresh button calls, one symbol at a time, so the page can show progress.
export const POST: RequestHandler = async ({ params }) => {
	try {
		const fresh = await refreshCompanySeries(params.symbol);
		if (!fresh) error(404, `${params.symbol.toUpperCase()} isn't listed on Angel One (NSE equity only).`);
		return json({ fetchedAt: fresh.fetchedAt, sessions: fresh.candles.length });
	} catch (e) {
		if (e && typeof e === 'object' && 'status' in e) throw e; // already a SvelteKit error()
		const message = e instanceof Error ? e.message : 'Unknown error';
		if (message === 'ANGEL_CREDENTIALS_MISSING')
			error(500, 'Angel One API credentials are not configured on the server.');
		error(502, message);
	}
};
