import { json, error } from '@sveltejs/kit';
import type { Config } from '@sveltejs/adapter-vercel';
import type { RequestHandler } from './$types';
import { getCompanyData } from '$lib/valuation/server/companyCache';
import { FINANCIALS_BATCH_SIZE } from '$lib/valuation/financialsLoad';

// Stores the Screener statements of up to FINANCIALS_BATCH_SIZE companies, one after another (the
// scraper keeps a polite gap between Screener requests). Resumable: a company whose stored record
// already has the yearly statements is a cache hit and costs nothing, so a repeated run only
// fetches what is still missing. Read-only accounts are refused by the access policy (a write).
export const config: Config = { maxDuration: 120 };

export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json().catch(() => null)) as { symbols?: unknown } | null;
	const symbols = body?.symbols;
	if (!Array.isArray(symbols) || symbols.length === 0 || !symbols.every((s) => typeof s === 'string' && s.trim())) {
		error(400, 'symbols must be a non-empty list of tickers.');
	}
	if (symbols.length > FINANCIALS_BATCH_SIZE) error(400, `At most ${FINANCIALS_BATCH_SIZE} symbols per request.`);
	const wanted = [...new Set((symbols as string[]).map((s) => s.trim().toUpperCase()))];
	const started = Date.now();
	let ok = 0;
	const failed: { symbol: string; error: string }[] = [];
	for (const symbol of wanted) {
		// Stop early rather than be cut off mid-request; the client carries on with the rest.
		if (Date.now() - started > 100_000) {
			failed.push({ symbol, error: 'not reached in time' });
			continue;
		}
		try {
			await getCompanyData(symbol);
			ok++;
		} catch (e) {
			failed.push({ symbol, error: e instanceof Error ? e.message.slice(0, 120) : 'Unknown error' });
		}
	}
	return json({ ok, failed, ms: Date.now() - started });
};
