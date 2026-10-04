import { json, error, isHttpError } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { fetchMarketDepth } from '$lib/valuation/server/angelone';
import { isMarketOpenIST } from '$lib/valuation/server/marketHours';

export const GET: RequestHandler = async ({ params }) => {
	try {
		// The order book only exists while the market is trading — there's no meaningful
		// "last known depth" to serve when it's closed, so this skips the live call entirely
		// rather than hitting Angel One for data that would just come back empty/stale.
		if (!isMarketOpenIST()) {
			error(409, 'Market is closed (NSE hours: 09:15–15:30 IST, Mon–Fri) — no live order book.');
		}
		const depth = await fetchMarketDepth(params.symbol);
		if (!depth) {
			error(404, `${params.symbol} isn't listed on Angel One (NSE equity only).`);
		}
		return json(depth);
	} catch (e) {
		// error(...) above throws a SvelteKit HttpError, which lands right back in this same
		// catch — it must be rethrown as-is rather than falling through to the generic 502
		// below, or the 409/404 above (and their actual messages) never reach the client.
		if (isHttpError(e)) throw e;
		const message = e instanceof Error ? e.message : 'Unknown error';
		if (message === 'ANGEL_CREDENTIALS_MISSING') {
			error(500, 'Angel One API credentials are not configured on the server.');
		}
		error(502, message);
	}
};
