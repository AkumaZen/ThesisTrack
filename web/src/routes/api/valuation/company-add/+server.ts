import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { verifySymbol } from '$lib/valuation/server/symbolVerify';
import { getCompanyData } from '$lib/valuation/server/companyCache';
import { refreshCompanySeries } from '$lib/valuation/server/companyGrowthSeries';
import { saveSavedValuationRow } from '$lib/valuation/server/savedValuationsStore';
import { startingTemplateFor } from '$lib/valuation/server/templatesStore';
import { freshAllAssumptions } from '$lib/valuation/valuationEngine';

/**
 * "Add company": checks the symbol is a real company (never a guess), then fills in its history
 * so the company page opens complete - the financial statements and ratios from Screener.in, and
 * about 700 days of daily prices from Angel One for the chart and the 200-day average - and puts
 * it on the watchlist with the same starting valuation its company page would show (a company
 * already on the watchlist keeps its valuation). The valuation is then refined on that page.
 */
export const POST: RequestHandler = async ({ request, locals }) => {
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
	let company: Awaited<ReturnType<typeof getCompanyData>>['data'] | null = null;
	try {
		company = (await getCompanyData(symbol)).data;
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

	// On the watchlist, starting where the company page starts: the template chosen for its
	// basket or this person, otherwise the blank assumptions, and shares from market cap / price.
	let watchlist: 'added' | 'already' | null = null;
	let watchlistError: string | null = null;
	if (company) {
		try {
			const starting = await startingTemplateFor(symbol, locals.user!.id);
			const saved = await saveSavedValuationRow(
				symbol,
				{
					name: company.name || name,
					lastUpdated: Date.now(),
					assumptions: starting ? structuredClone(starting.template.assumptions) : freshAllAssumptions(),
					shares:
						company.marketCap && company.cmp
							? Math.round((company.marketCap / company.cmp) * 100) / 100
							: 100,
					activeMethod: starting?.template.activeMethod ?? 'pe',
					activeScenario: 'base',
					baseVersion: 0
				},
				locals.user!.username
			);
			watchlist = saved.ok ? 'added' : 'already';
		} catch (e) {
			watchlistError = e instanceof Error ? e.message : 'Could not add it to the watchlist.';
		}
	}

	return json({
		ok: true,
		watchlist,
		watchlistError,
		symbol,
		name,
		listedOnAngelOne,
		fundamentals,
		fundamentalsError,
		priceSessions,
		pricesError
	});
};
