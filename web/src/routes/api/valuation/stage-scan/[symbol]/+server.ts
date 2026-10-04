import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getStageScanResult } from '$lib/server/stageScanEngine';
import { getStageScanUniverse } from '$lib/server/stageScanUniverse';

// One stock's scan - the scanner page fetches the ones it has no fresh cached result for, one
// at a time, so a cold universe fills in progressively instead of blocking the page.
export const GET: RequestHandler = async ({ params }) => {
	const symbol = params.symbol.toUpperCase();
	if (!(await getStageScanUniverse()).includes(symbol)) {
		error(404, `${symbol} is not in the scanner's universe (the sector baskets).`);
	}
	try {
		const result = await getStageScanResult(symbol);
		if (!result) error(404, `No price history is available for ${symbol}.`);
		return json(result);
	} catch (e) {
		if (e && typeof e === 'object' && 'status' in e) throw e;
		const message = e instanceof Error ? e.message : 'Unknown error';
		if (message === 'ANGEL_CREDENTIALS_MISSING') {
			error(500, 'Angel One API credentials are not configured on the server.');
		}
		error(502, message);
	}
};
