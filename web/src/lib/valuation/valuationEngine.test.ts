import { describe, it, expect } from 'vitest';
import {
	project,
	cagr,
	defaultYearAssumptions,
	defaultScenario,
	freshScenario,
	freshAllAssumptions,
	METHODS,
	SCENARIOS,
	type ScenarioAssumptions
} from './valuationEngine';

describe('defaultYearAssumptions', () => {
	it('applies sane defaults', () => {
		const y = defaultYearAssumptions();
		expect(y).toEqual({
			revenueGrowthPct: 15,
			expensePct: 85,
			otherIncome: 0,
			interest: 0,
			depreciation: 0,
			taxPct: 25,
			dividendPayoutPct: 0,
			netDebt: 0,
			targetMultiple: 20
		});
	});

	it('lets overrides win', () => {
		const y = defaultYearAssumptions({ revenueGrowthPct: 8, targetMultiple: 30 });
		expect(y.revenueGrowthPct).toBe(8);
		expect(y.targetMultiple).toBe(30);
		expect(y.taxPct).toBe(25); // untouched default
	});
});

describe('project (PE method)', () => {
	it("rolls sales forward, expenses as a % of that same year's sales, and applies the PE multiple to EPS", () => {
		// Base sales 100, flat 10% growth -> 110. Expenses at 80% of sales -> 88, EBITDA 22.
		// No other income/interest/depreciation, 25% tax, 10 shares, PE 20x.
		const assumptions = {
			years: [
				defaultYearAssumptions({ revenueGrowthPct: 10, expensePct: 80, targetMultiple: 20 }),
				defaultYearAssumptions({ revenueGrowthPct: 10, expensePct: 80, targetMultiple: 20 }),
				defaultYearAssumptions({ revenueGrowthPct: 10, expensePct: 80, targetMultiple: 20 })
			] as ScenarioAssumptions['years']
		};
		const [y1] = project('pe', 100, 0, 10, assumptions);

		expect(y1.sales).toBeCloseTo(110);
		expect(y1.expenses).toBeCloseTo(88); // 110 * 80%
		expect(y1.ebitda).toBeCloseTo(22); // 110 - 88
		expect(y1.pbt).toBeCloseTo(22); // no other income/interest/depreciation
		expect(y1.tax).toBeCloseTo(5.5); // 25% of 22
		expect(y1.netProfit).toBeCloseTo(16.5);
		expect(y1.eps).toBeCloseTo(1.65); // 16.5 / 10 shares
		expect(y1.impliedPrice).toBeCloseTo(33); // eps 1.65 * PE 20
	});

	it('compounds sales growth correctly across all 3 years, independent of the expense ratio', () => {
		const assumptions = {
			years: [
				defaultYearAssumptions({ revenueGrowthPct: 20 }),
				defaultYearAssumptions({ revenueGrowthPct: 20 }),
				defaultYearAssumptions({ revenueGrowthPct: 20 })
			] as ScenarioAssumptions['years']
		};
		const years = project('pe', 100, 0, 10, assumptions);
		expect(years[0].sales).toBeCloseTo(120);
		expect(years[1].sales).toBeCloseTo(144); // 120 * 1.2
		expect(years[2].sales).toBeCloseTo(172.8); // 144 * 1.2
	});

	it("expenses track the ratio even as sales changes — not a growth rate off last year's expenses", () => {
		// Sales grows 10%/year at a constant 80% expense ratio: expenses must scale with the
		// (changing) sales figure each year, not compound independently off the prior year's
		// expense value.
		const assumptions = {
			years: [
				defaultYearAssumptions({ revenueGrowthPct: 10, expensePct: 80 }),
				defaultYearAssumptions({ revenueGrowthPct: 10, expensePct: 80 }),
				defaultYearAssumptions({ revenueGrowthPct: 10, expensePct: 80 })
			] as ScenarioAssumptions['years']
		};
		const years = project('pe', 100, 0, 10, assumptions);
		expect(years[0].sales).toBeCloseTo(110);
		expect(years[0].expenses).toBeCloseTo(88); // 110 * 80%
		expect(years[1].sales).toBeCloseTo(121);
		expect(years[1].expenses).toBeCloseTo(96.8); // 121 * 80%, not 88 * 1.1
	});
});

describe('project (P/B method)', () => {
	it('compounds book value per share via retained earnings and applies the P/B multiple', () => {
		const assumptions = {
			years: [
				defaultYearAssumptions({
					revenueGrowthPct: 0,
					expensePct: 80,
					dividendPayoutPct: 0,
					targetMultiple: 3
				}),
				defaultYearAssumptions({
					revenueGrowthPct: 0,
					expensePct: 80,
					dividendPayoutPct: 0,
					targetMultiple: 3
				}),
				defaultYearAssumptions({
					revenueGrowthPct: 0,
					expensePct: 80,
					dividendPayoutPct: 0,
					targetMultiple: 3
				})
			] as ScenarioAssumptions['years']
		};
		// Sales 100, expenses at 80% -> 80, EBITDA 20, PBT 20, tax 25% -> net profit 15, EPS
		// 15/10 = 1.5. Full retention (0% payout) -> BVPS grows by 1.5 each year from a base of 10.
		const years = project('pb', 100, 10, 10, assumptions);
		expect(years[0].bookValuePerShare).toBeCloseTo(11.5);
		expect(years[0].impliedPrice).toBeCloseTo(34.5); // 11.5 * 3
		expect(years[1].bookValuePerShare).toBeCloseTo(13.0);
	});

	it('a 100% dividend payout leaves book value per share unchanged', () => {
		const assumptions = {
			years: [
				defaultYearAssumptions({ revenueGrowthPct: 0, expensePct: 80, dividendPayoutPct: 100 }),
				defaultYearAssumptions({ revenueGrowthPct: 0, expensePct: 80, dividendPayoutPct: 100 }),
				defaultYearAssumptions({ revenueGrowthPct: 0, expensePct: 80, dividendPayoutPct: 100 })
			] as ScenarioAssumptions['years']
		};
		const years = project('pb', 100, 10, 10, assumptions);
		expect(years[0].bookValuePerShare).toBeCloseTo(10); // fully paid out, nothing retained
	});
});

describe('project (EV/EBITDA method)', () => {
	it('subtracts net debt from EV to get equity value, then divides by shares', () => {
		const assumptions = {
			years: [
				defaultYearAssumptions({
					revenueGrowthPct: 0,
					expensePct: 80,
					targetMultiple: 10,
					netDebt: 50
				}),
				defaultYearAssumptions({ revenueGrowthPct: 0, expensePct: 80, targetMultiple: 10 }),
				defaultYearAssumptions({ revenueGrowthPct: 0, expensePct: 80, targetMultiple: 10 })
			] as ScenarioAssumptions['years']
		};
		// Sales 100, expenses 80 -> EBITDA 20, EV = 20 * 10 = 200, equity value = 200 - 50 = 150,
		// / 10 shares = 15.
		const [y1] = project('ev_ebitda', 100, 0, 10, assumptions);
		expect(y1.impliedPrice).toBeCloseTo(15);
	});
});

describe('project (Mkt Cap/Sales method)', () => {
	it('applies the multiple directly to sales', () => {
		const assumptions = {
			years: [
				defaultYearAssumptions({ revenueGrowthPct: 0, targetMultiple: 3 }),
				defaultYearAssumptions({ revenueGrowthPct: 0, targetMultiple: 3 }),
				defaultYearAssumptions({ revenueGrowthPct: 0, targetMultiple: 3 })
			] as ScenarioAssumptions['years']
		};
		// Sales 100 * 3 = 300 mkt cap / 10 shares = 30.
		const [y1] = project('mcap_sales', 100, 0, 10, assumptions);
		expect(y1.impliedPrice).toBeCloseTo(30);
	});
});

describe('project edge cases', () => {
	it('does not divide by zero when shares is 0', () => {
		const assumptions = {
			years: [0, 1, 2].map(() => defaultYearAssumptions()) as ScenarioAssumptions['years']
		};
		const [y1] = project('pe', 100, 0, 0, assumptions);
		expect(y1.eps).toBe(0);
		expect(Number.isFinite(y1.eps)).toBe(true);
	});

	it('coalesces a year-assumptions object with missing fields to safe defaults instead of NaN', () => {
		// Real incident: a hand-written/manually-edited localStorage record (bypassing this
		// module's own defaulting via defaultYearAssumptions/freshScenario) with a year object
		// missing most fields — e.g. only { targetMultiple: 18 } — produced `undefined / 100`
		// (NaN) that cascaded through sales/EBITDA/implied price and rendered as a literal
		// "NaN%" in the watchlist and company page.
		const assumptions = {
			years: [
				{ targetMultiple: 18 },
				{ targetMultiple: 18 },
				{ targetMultiple: 18 }
			] as unknown as ScenarioAssumptions['years']
		};
		const years = project('ev_ebitda', 797, 91.4, 8, assumptions);
		for (const y of years) {
			expect(Number.isFinite(y.sales)).toBe(true);
			expect(Number.isFinite(y.ebitda)).toBe(true);
			expect(Number.isFinite(y.impliedPrice)).toBe(true);
		}
	});
});

describe('cagr', () => {
	it('computes the compound annual growth rate correctly', () => {
		// 100 -> 200 over 1 year is a 100% CAGR.
		expect(cagr(200, 100, 1)).toBeCloseTo(100);
		// 100 -> 121 over 2 years is 10% CAGR (1.1^2 = 1.21).
		expect(cagr(121, 100, 2)).toBeCloseTo(10);
	});

	it('returns 0 for non-positive inputs rather than NaN/Infinity', () => {
		expect(cagr(0, 100, 1)).toBe(0);
		expect(cagr(100, 0, 1)).toBe(0);
		expect(cagr(-50, 100, 1)).toBe(0);
	});

	it('returns 0 for a NaN target or base rather than propagating NaN', () => {
		// `NaN <= 0` is always false, so a numeric-only guard (base <= 0 || target <= 0) lets a
		// NaN input straight through — this must use Number.isFinite() to actually catch it.
		expect(cagr(NaN, 100, 1)).toBe(0);
		expect(cagr(100, NaN, 1)).toBe(0);
		expect(Number.isNaN(cagr(NaN, 100, 1))).toBe(false);
	});
});

describe('freshScenario / freshAllAssumptions', () => {
	it('uses steeper growth for bull than base than bear', () => {
		const bear = freshScenario('pe', 'bear');
		const base = freshScenario('pe', 'base');
		const bull = freshScenario('pe', 'bull');
		expect(bear.years[0].revenueGrowthPct).toBeLessThan(base.years[0].revenueGrowthPct);
		expect(base.years[0].revenueGrowthPct).toBeLessThan(bull.years[0].revenueGrowthPct);
	});

	it('freshAllAssumptions covers every method x scenario combination', () => {
		const all = freshAllAssumptions();
		for (const m of METHODS) {
			for (const s of SCENARIOS) {
				expect(all[m][s].years).toHaveLength(3);
			}
		}
	});
});

describe('defaultScenario', () => {
	it('applies per-year growth rates from the given array', () => {
		const s = defaultScenario(20, [5, 10, 15]);
		expect(s.years.map((y) => y.revenueGrowthPct)).toEqual([5, 10, 15]);
		expect(s.years.every((y) => y.targetMultiple === 20)).toBe(true);
	});
});
