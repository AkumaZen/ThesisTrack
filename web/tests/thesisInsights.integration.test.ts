// DB-backed check of the thesis page extras: base-case target from a saved valuation (NSE ticker
// first, then BSE) and the stale check from stored daily closes. Throwaway symbols, cleaned up.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inArray } from 'drizzle-orm';
import { db } from '../src/lib/server/db';
import { companyCache, companyGrowthSeriesCache, savedValuations } from '../src/lib/server/db/valuationSchema';
import { priceTargetFor, staleForMany } from '../src/lib/server/services/thesisInsights';
import { targetForSaved } from '../src/lib/valuation/fairValue';
import { dbReachable } from './dbReachable';

const dbUp = await dbReachable();
const NSE = `VTNSE${Date.now() % 1e8}`;
const BSE = `VTBSE${Date.now() % 1e8}`;
const SYMS = [NSE, BSE];

const year = { revenueGrowthPct: 20, expensePct: 75, otherIncome: 0, interest: 0, depreciation: 10, taxPct: 25, dividendPayoutPct: 0, netDebt: 0, targetMultiple: 25 };
const scenario = { years: [year, year, year] };
const assumptions = { pe: { bear: scenario, base: scenario, bull: scenario } };
const companyData = {
	symbol: NSE, cmp: 100, marketCap: 1000, bookValuePerShare: 50, sector: 'Test',
	years: [{ sales: 1000 }], history: [], balanceSheet: null, cashConversionCycle: null, industry: null
};

// Closes: 2026-01-01 .. 2026-01-03 at 100, then 2026-10-01 at 130.
const candles = [
	{ date: '2026-01-01', close: 100 },
	{ date: '2026-01-02', close: 100 },
	{ date: '2026-01-03', close: 100 },
	{ date: '2026-10-01', close: 130 }
];

beforeAll(async () => {
	if (!dbUp) return;
	await db.insert(savedValuations).values({ symbol: BSE, name: 'VT', lastUpdated: 1, assumptions, shares: 10, activeMethod: 'pe' });
	await db.insert(companyCache).values({ symbol: BSE, basis: 'consolidated', data: companyData, fetchedAt: 1 });
	await db.insert(companyGrowthSeriesCache).values({ symbol: NSE, candles, fetchedAt: Date.now() });
});

afterAll(async () => {
	if (!dbUp) return;
	await db.delete(savedValuations).where(inArray(savedValuations.symbol, SYMS));
	await db.delete(companyCache).where(inArray(companyCache.symbol, SYMS));
	await db.delete(companyGrowthSeriesCache).where(inArray(companyGrowthSeriesCache.symbol, SYMS));
});

describe.skipIf(!dbUp)('thesis insights', () => {
	it('falls back from the NSE ticker to the BSE ticker and matches the watchlist number', async () => {
		const expected = targetForSaved(
			{ name: 'VT', lastUpdated: 1, assumptions: assumptions as never, shares: 10, activeMethod: 'pe' },
			companyData as never
		)!.target;
		const r = await priceTargetFor({ nseTicker: NSE, bseTicker: BSE }, 100, 130);
		expect(r).toMatchObject({ state: 'in_progress', symbol: BSE, target: expected });
		expect(expected).toBeGreaterThan(0);
	});

	it('no saved valuation for either ticker', async () => {
		expect(await priceTargetFor({ nseTicker: NSE, bseTicker: null }, 100, 130)).toEqual({ state: 'no_valuation', symbol: NSE });
		expect(await priceTargetFor({}, null, null)).toEqual({ state: 'no_valuation', symbol: null });
	});

	it('stale: review-day close vs latest close, one batched read', async () => {
		const [moved, old, none] = await staleForMany(
			[
				{ company: { nseTicker: NSE }, lastReviewed: '2026-01-05' }, // close on 01-03 was 100, now 130
				{ company: { nseTicker: NSE }, lastReviewed: '2026-01-02' },
				{ company: { nseTicker: 'NOSUCHSYMBOL' }, lastReviewed: '2026-10-10' }
			],
			'2026-10-17'
		);
		expect(moved).toMatchObject({ stale: true, price_at_review: 100, current_price: 130 });
		expect(moved.reasons).toHaveLength(2);
		expect(old.price_at_review).toBe(100);
		expect(none).toMatchObject({ stale: false, price_at_review: null, reasons: [] });
	});
});
