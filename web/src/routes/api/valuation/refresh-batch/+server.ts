import { json, error } from '@sveltejs/kit';
import type { Config } from '@sveltejs/adapter-vercel';
import type { RequestHandler } from './$types';
import { BATCH_SIZE, refreshBatch } from '$lib/valuation/server/batchRefresh';
import { noteManualRefresh } from '$lib/valuation/server/intradayPrices';

// Brings up to 50 companies' stored prices up to date in one call: one Angel One quote request for
// those that only need today's session, a full history fetch for the rest. Read-only accounts are
// refused by the access policy (lib/access.ts: writes under /api/valuation), as for refresh-series.
// The time limit is for the worst case, 50 full fetches at the candle rate limit.
export const config: Config = { maxDuration: 120 };

export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json().catch(() => null)) as { symbols?: unknown } | null;
	const symbols = body?.symbols;
	if (!Array.isArray(symbols) || symbols.length === 0 || !symbols.every((s) => typeof s === 'string' && s.trim())) {
		error(400, 'symbols must be a non-empty list of tickers.');
	}
	if (symbols.length > BATCH_SIZE) error(400, `At most ${BATCH_SIZE} symbols per request.`);
	const started = Date.now();
	// Background price passes step aside while someone refreshes by hand.
	await noteManualRefresh().catch(() => {});
	try {
		const summary = await refreshBatch(symbols as string[]);
		return json({ ...summary, ms: Date.now() - started });
	} catch (e) {
		const message = e instanceof Error ? e.message : 'Unknown error';
		error(message === 'ANGEL_CREDENTIALS_MISSING' ? 500 : 502, message);
	}
};
