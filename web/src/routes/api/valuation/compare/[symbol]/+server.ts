import { json, error } from '@sveltejs/kit';
import type { Config } from '@sveltejs/adapter-vercel';
import type { RequestHandler } from './$types';
import { getCompareStatements } from '$lib/valuation/server/compareStatements';

// An uncached company is one page plus about a dozen spaced breakdown calls.
export const config: Config = { maxDuration: 60 };

export const GET: RequestHandler = async ({ params, url }) => {
	const symbol = params.symbol.trim().toUpperCase();
	if (!/^[A-Z0-9&._-]{1,30}$/.test(symbol)) error(400, 'Invalid symbol');
	try {
		const data = await getCompareStatements(symbol, { refresh: url.searchParams.get('refresh') === '1' });
		return json(data);
	} catch (e) {
		const message = e instanceof Error ? e.message : 'Unknown scrape error';
		if (message.startsWith('NOT_FOUND')) error(404, `Not found on Screener: ${symbol}`);
		error(502, message);
	}
};
