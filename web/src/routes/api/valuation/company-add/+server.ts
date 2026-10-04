import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { verifySymbol } from '$lib/valuation/server/symbolVerify';
import { getCompanyData } from '$lib/valuation/server/companyCache';
import { refreshCompanySeries } from '$lib/valuation/server/companyGrowthSeries';

/**
 * "Add company": checks the symbol is a real company (never a guess), then fills in its history
 * so the company page opens complete - the financial statements and ratios from Screener.in, and
 * about 700 days of daily prices from Angel One for the chart and the 200-day average. The
 * valuation itself is then made on the company page.
 */
export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json().catch(() => null)) as { symbol?: unknown } | null;
	if (typeof body?.symbol !== 'string' || !body.symbol.trim()) error(400, 'Pick a company first.');

	let verified;
	try {
		verified = await verifySymbol(body.symbol);
	} catch (e) {
		error(502, (e as Error).message);
	}
	if (!verified.ok) return json({ ok: false, reason: verified.reason, suggestions: verified.suggestions });

	const { symbol, name, listedOnAngelOne } = verified;
	let fundamentals = false;
	let fundamentalsError: string | null = null;
	try {
		await getCompanyData(symbol);
		fundamentals = true;
	} catch (e) {
		fundamentalsError = e instanceof Error ? e.message : 'Could not read the financial statements.';
	}

	let priceSessions: number | null = null;
	let pricesError: string | null = null;
	if (listedOnAngelOne) {
		try {
			priceSessions = (await refreshCompanySeries(symbol))?.candles.length ?? null;
		} catch (e) {
			pricesError = e instanceof Error ? e.message : 'Could not fetch prices.';
		}
	}

	return json({
		ok: true,
		symbol,
		name,
		listedOnAngelOne,
		fundamentals,
		fundamentalsError,
		priceSessions,
		pricesError
	});
};
