import { json, error } from '@sveltejs/kit';
import type { Config } from '@sveltejs/adapter-vercel';
import type { RequestHandler } from './$types';
import { refreshLongRange } from '$lib/valuation/server/longRangeStore';
import { LONG_RANGE_BATCH_SIZE } from '$lib/valuation/longRange';

// Stores the 5-year high and the close three years ago of up to LONG_RANGE_BATCH_SIZE companies
// (one Angel One candle request each, within the candle rate limit). Resumable: the plan is the
// companies with no stored row. Read-only accounts are refused by the access policy (a write).
export const config: Config = { maxDuration: 120 };

export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json().catch(() => null)) as { symbols?: unknown } | null;
	const symbols = body?.symbols;
	if (!Array.isArray(symbols) || symbols.length === 0 || !symbols.every((s) => typeof s === 'string' && s.trim())) {
		error(400, 'symbols must be a non-empty list of tickers.');
	}
	if (symbols.length > LONG_RANGE_BATCH_SIZE) error(400, `At most ${LONG_RANGE_BATCH_SIZE} symbols per request.`);
	const started = Date.now();
	const wanted = [...new Set((symbols as string[]).map((s) => s.trim().toUpperCase()))];
	try {
		return json({ ...(await refreshLongRange(wanted)), ms: Date.now() - started });
	} catch (e) {
		const message = e instanceof Error ? e.message : 'Unknown error';
		error(message === 'ANGEL_CREDENTIALS_MISSING' ? 500 : 502, message);
	}
};
