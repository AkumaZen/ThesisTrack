import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { refreshPrice } from '$lib/valuation/server/companyCache';

export const POST: RequestHandler = async ({ params }) => {
	try {
		const data = await refreshPrice(params.symbol);
		return json(data);
	} catch (e) {
		const message = e instanceof Error ? e.message : 'Unknown error';
		if (message === 'NOT_CACHED') {
			error(404, 'Load the company page before refreshing its price.');
		}
		if (message === 'MARKET_CLOSED') {
			error(
				409,
				'Market is closed (NSE hours: 09:15–15:30 IST, Mon–Fri) — showing the last close.'
			);
		}
		if (message === 'PRICE_NOT_FOUND') {
			error(502, `No live price available for ${params.symbol} on Angel One.`);
		}
		if (message === 'ANGEL_CREDENTIALS_MISSING') {
			error(500, 'Angel One API credentials are not configured on the server.');
		}
		error(502, message);
	}
};
