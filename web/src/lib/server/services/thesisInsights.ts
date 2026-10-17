// Thesis page extras: the base-case price target from the saved valuation and the stale-thesis
// check. Reads STORED data only (saved valuation, cached company statements, stored daily closes):
// no Screener scrape and no Angel One call, so a page view never spends either.
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { companyCache } from '../db/valuationSchema';
import { getSavedValuationRow } from '$lib/valuation/server/savedValuationsStore';
import { readCachedCloses } from '$lib/valuation/server/companyGrowthSeries';
import { targetForSaved, type CompanyForTarget } from '$lib/valuation/fairValue';
import { closeOnOrBefore, latestClose } from '$lib/entryPrice.js';
import { targetProgress, type TargetProgress } from '$lib/priceTarget';
import { staleReasons, staleThesis } from '$lib/staleThesis';
import { priceSymbol, todayIst } from './entryPrice';

type Tickers = { nseTicker?: string | null; bseTicker?: string | null };

export type PriceTargetOut =
	| { state: 'no_valuation'; symbol: string | null }
	// A valuation is saved but the target can't be computed (no cached statements, or the model
	// gives no positive FY+2E price).
	| { state: 'no_target'; symbol: string; reason: 'no_company_data' | 'not_computable' }
	| {
			state: TargetProgress['state'];
			target: number;
			symbol: string;
			method: string;
			upside_pct: number | null;
			progress_pct: number | null;
			bar_pct: number | null;
			required_annual_pct: number | null;
	  };

/** Symbols to look a company up under: NSE ticker first, then BSE. */
export function tickerCandidates(c: Tickers): string[] {
	return [c.nseTicker, c.bseTicker]
		.map((t) => t?.trim().toUpperCase())
		.filter((t, i, a): t is string => !!t && a.indexOf(t) === i);
}

/** Base-case FY+2E target (the watchlist's number, via targetForSaved) and progress toward it.
 *  The saved valuation is keyed by symbol, so there is one per ticker: the NSE one wins, else BSE. */
export async function priceTargetFor(
	c: Tickers,
	entry: number | null,
	current: number | null
): Promise<PriceTargetOut> {
	const candidates = tickerCandidates(c);
	for (const symbol of candidates) {
		const record = await getSavedValuationRow(symbol);
		if (!record) continue;
		// Cached statements regardless of age: the target only needs sales and book value, and a
		// page view must not trigger a Screener scrape.
		const [cached] = await db.select().from(companyCache).where(eq(companyCache.symbol, symbol));
		if (!cached) return { state: 'no_target', symbol, reason: 'no_company_data' };
		const computed = targetForSaved(record, cached.data as CompanyForTarget);
		if (!computed) return { state: 'no_target', symbol, reason: 'not_computable' };
		const p = targetProgress(entry, current, computed.target);
		return {
			state: p.state,
			target: computed.target,
			symbol,
			method: computed.method,
			upside_pct: p.upsidePct,
			progress_pct: p.progressPct,
			bar_pct: p.barPct,
			required_annual_pct: p.requiredAnnualPct
		};
	}
	return { state: 'no_valuation', symbol: candidates[0] ?? null };
}

export interface StaleOut {
	stale: boolean;
	reasons: string[];
	days: number | null;
	move_pct: number | null;
	price_at_review: number | null;
	current_price: number | null;
}

export interface StaleRequest {
	company: Tickers;
	lastReviewed: string | null;
}

/** Stale check for many theses with ONE query for all stored price series. */
export async function staleForMany(items: StaleRequest[], today = todayIst()): Promise<StaleOut[]> {
	const symbolOf = (c: Tickers) => priceSymbol(c) ?? '';
	const series = await readCachedCloses(items.map((i) => symbolOf(i.company)).filter(Boolean));
	return items.map(({ company, lastReviewed }) => {
		const s = series.get(symbolOf(company));
		const atReview = s && lastReviewed ? closeOnOrBefore(s.dates, s.closes, lastReviewed)?.price ?? null : null;
		const now = s ? latestClose(s.dates, s.closes)?.price ?? null : null;
		const r = staleThesis({ lastReviewed, today, priceAtReview: atReview, currentPrice: now });
		return {
			stale: r.stale,
			reasons: staleReasons(r, atReview, now),
			days: r.days,
			move_pct: r.movePct,
			price_at_review: atReview,
			current_price: now
		};
	});
}
