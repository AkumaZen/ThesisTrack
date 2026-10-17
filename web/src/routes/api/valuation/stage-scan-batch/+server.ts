import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getStageScanBatch, SCAN_BATCH_SIZE } from '$lib/valuation/server/stageScanBatch';
import { getStageScanUniverse } from '$lib/valuation/server/stageScanUniverse';

// The scanner page's way to fill in the scans it has no fresh cached result for: up to 50 symbols
// per call, with one Angel One quote request for the live overlay of all of them. Symbols outside
// the scanner's universe come back as `outside`, like the single route's 404.
// A GET (?symbols=A,B,C) because read-only accounts may look at the scanner but not POST.
export const GET: RequestHandler = async ({ url }) => {
	const symbols = (url.searchParams.get('symbols') ?? '')
		.split(',')
		.map((s) => s.trim())
		.filter(Boolean);
	if (symbols.length === 0) error(400, 'symbols must be a non-empty list of tickers.');
	if (symbols.length > SCAN_BATCH_SIZE) error(400, `At most ${SCAN_BATCH_SIZE} symbols per request.`);
	const universe = new Set(await getStageScanUniverse());
	const wanted = [...new Set(symbols.map((s) => s.toUpperCase()))];
	const inside = wanted.filter((s) => universe.has(s));
	try {
		const items = await getStageScanBatch(inside);
		const bySymbol = new Map(items.map((i) => [i.symbol, i]));
		return json({
			results: wanted.map((s) => bySymbol.get(s) ?? { symbol: s, result: null, outside: true })
		});
	} catch (e) {
		error(502, e instanceof Error ? e.message : 'Unknown error');
	}
};
