import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { presetMatchesFor } from '$lib/valuation/server/presetStore';

const MAX_SYMBOLS = 300;

// Scan Match for a list of tickers (the watchlist's badges): which preset scans each passes now,
// from the stored scan results. Never calls Angel One. A GET so read-only accounts can use it.
export const GET: RequestHandler = async ({ url }) => {
	const symbols = (url.searchParams.get('symbols') ?? '')
		.split(',')
		.map((s) => s.trim())
		.filter(Boolean);
	if (symbols.length === 0) error(400, 'symbols must be a non-empty list of tickers.');
	if (symbols.length > MAX_SYMBOLS) error(400, `At most ${MAX_SYMBOLS} symbols per request.`);
	try {
		return json({ matches: await presetMatchesFor(symbols) });
	} catch (e) {
		error(502, e instanceof Error ? e.message : 'Unknown error');
	}
};
