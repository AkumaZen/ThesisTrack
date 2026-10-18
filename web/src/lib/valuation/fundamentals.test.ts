import { describe, expect, it } from 'vitest';
import {
	computeFundamentalMetrics,
	fundamentalDetail,
	isFinancialIndustry,
	passesFundamentalPreset,
	type AnnualRow,
	type FundamentalPresetId,
	type ResultQuarter
} from './fundamentals';

const year = (label: string, over: Partial<AnnualRow> = {}): AnnualRow => ({
	label,
	sales: 1000,
	opmPct: 15,
	netProfit: 100,
	equity: 1000,
	borrowings: 200,
	fixedAssets: 500,
	cwip: 20,
	roce: 18,
	...over
});

/** Four financial years Mar 2023..Mar 2026. */
function years(over: Partial<AnnualRow>[] = []): AnnualRow[] {
	return ['Mar 2023', 'Mar 2024', 'Mar 2025', 'Mar 2026'].map((l, i) => year(l, over[i] ?? {}));
}

const quarter = (label: string, sales: number, netProfit: number, opmPct: number): ResultQuarter => ({
	label,
	sales,
	netProfit,
	opmPct
});

const quarters = (now: Partial<ResultQuarter> = {}): ResultQuarter[] => [
	quarter('Jun 2025', 100, 10, 15),
	quarter('Sep 2025', 105, 11, 15),
	quarter('Dec 2025', 110, 12, 16),
	quarter('Mar 2026', 115, 13, 16),
	{ ...quarter('Jun 2026', 130, 14, 18), ...now }
];

const passes = (id: FundamentalPresetId, input: Parameters<typeof computeFundamentalMetrics>[0]) =>
	passesFundamentalPreset(id, computeFundamentalMetrics(input));

describe('computeFundamentalMetrics', () => {
	it('is null with nothing to measure', () => {
		expect(computeFundamentalMetrics({})).toBeNull();
		expect(computeFundamentalMetrics({ quarters: [], annual: [] })).toBeNull();
	});

	it('measures ROCE, debt, CAGR, capex and borrowings from the yearly rows', () => {
		const m = computeFundamentalMetrics({
			annual: years([
				{ sales: 1000, netProfit: 100, roce: 14 },
				{ sales: 1200, netProfit: 130, roce: 16, borrowings: 400, fixedAssets: 500, cwip: 20 },
				{ sales: 1400, netProfit: 150, roce: 18, borrowings: 360, fixedAssets: 520, cwip: 30 },
				{ sales: 1520, netProfit: 160, roce: 22, borrowings: 270, equity: 900, fixedAssets: 600, cwip: 90 }
			])
		})!;
		expect(m.roce).toBe(22);
		expect(m.roce3yAvg).toBeCloseTo((16 + 18 + 22) / 3, 9);
		expect(m.debtEquity).toBeCloseTo(0.3, 9);
		expect(m.salesCagr3).toBeCloseTo((Math.pow(1520 / 1000, 1 / 3) - 1) * 100, 9);
		expect(m.profitCagr3).toBeCloseTo((Math.pow(160 / 100, 1 / 3) - 1) * 100, 9);
		expect(m.capexGrowthPct).toBeCloseTo(((600 + 90) / (520 + 30) - 1) * 100, 9);
		expect(m.cwipPct).toBeCloseTo(15, 9);
		expect(m.borrowingsChangePct).toBeCloseTo((270 / 360 - 1) * 100, 9);
		expect(m.borrowingsPrevChangePct).toBeCloseTo((360 / 400 - 1) * 100, 9);
		expect(m.yearLabel).toBe('Mar 2026');
	});

	it('will not compute a 3-year CAGR across a missing year', () => {
		const gappy = [year('Mar 2022'), year('Mar 2024'), year('Mar 2025'), year('Mar 2026')];
		const m = computeFundamentalMetrics({ annual: gappy })!;
		expect(m.salesCagr3).toBeNull();
		expect(m.profitCagr3).toBeNull();
	});

	it('falls back to the headline ROCE when no yearly series is stored', () => {
		const m = computeFundamentalMetrics({ roce: 25, quarters: quarters() })!;
		expect(m.roce).toBe(25);
		expect(m.roce3yAvg).toBeNull();
	});

	it('compares the latest quarter with the same quarter a year earlier', () => {
		const m = computeFundamentalMetrics({ quarters: quarters() })!;
		expect(m.salesYoY).toBeCloseTo(30, 9);
		expect(m.profitYoY).toBeCloseTo(40, 9);
		expect(m.opmChangePp).toBe(3);
		expect(m.quarterLabel).toBe('Jun 2026');
	});

	it('leaves quarter comparisons blank when the year-ago quarter is missing', () => {
		const m = computeFundamentalMetrics({ quarters: quarters().slice(1) })!;
		expect(m.salesYoY).toBeNull();
		expect(m.opmChangePp).toBeNull();
	});
});

describe('fundamental presets and their thresholds', () => {
	it('High ROCE: 20%+ now and a 15%+ three-year average; lenders excluded', () => {
		const good = years([{ roce: 17 }, { roce: 18 }, { roce: 19 }, { roce: 21 }]);
		expect(passes('high-roce', { annual: good })).toBe(true);
		expect(passes('high-roce', { annual: years([{}, {}, {}, { roce: 19.9 }]) })).toBe(false);
		// 20%+ today but a weak three-year average.
		expect(passes('high-roce', { annual: years([{}, { roce: 5 }, { roce: 8 }, { roce: 21 }]) })).toBe(false);
		expect(passes('high-roce', { annual: good, industry: 'Private Sector Bank' })).toBe(false);
	});

	it('Low debt/equity: at most 0.5x equity', () => {
		const at = (borrowings: number, equity = 1000) => years([{}, {}, {}, { borrowings, equity }]);
		expect(passes('low-debt', { annual: at(500) })).toBe(true);
		expect(passes('low-debt', { annual: at(501) })).toBe(false);
		expect(passes('low-debt', { annual: at(0) })).toBe(true);
		// Negative or zero equity is not a debt ratio.
		expect(passes('low-debt', { annual: at(10, -50) })).toBe(false);
		expect(passes('low-debt', { annual: at(10), industry: 'Non Banking Financial Company (NBFC)' })).toBe(false);
	});

	it('OPM expansion: the latest quarter margin 2+ points above a year earlier', () => {
		expect(passes('opm-expansion', { quarters: quarters({ opmPct: 17 }) })).toBe(true); // 15 -> 17
		expect(passes('opm-expansion', { quarters: quarters({ opmPct: 16.9 }) })).toBe(false);
	});

	it('3Y CAGR: sales and profit each 15%+ a year', () => {
		const grow = (sales: number, profit: number) =>
			years([{ sales: 1000, netProfit: 100 }, {}, {}, { sales, netProfit: profit }]);
		expect(passes('cagr-3y', { annual: grow(1521, 152.1) })).toBe(true); // 15.0%+
		expect(passes('cagr-3y', { annual: grow(1520, 160) })).toBe(false); // 1.52^(1/3) = 14.96%
		expect(passes('cagr-3y', { annual: grow(2000, 100) })).toBe(false); // profit flat
	});

	it('Heavy capex: fixed assets + CWIP up 20%+ and CWIP 10%+ of fixed assets', () => {
		const capex = (fa: number, cwip: number) =>
			years([{}, {}, { fixedAssets: 500, cwip: 100 }, { fixedAssets: fa, cwip }]);
		expect(passes('heavy-capex', { annual: capex(600, 120) })).toBe(true); // 720/600 = +20%, CWIP 20%
		expect(passes('heavy-capex', { annual: capex(590, 120) })).toBe(false); // +18.3%
		expect(passes('heavy-capex', { annual: capex(660, 50) })).toBe(false); // +18.3%, CWIP 7.6%
		expect(passes('heavy-capex', { annual: capex(640, 90) })).toBe(true); // +21.7%, CWIP 14%
	});

	it('Deleverage: borrowings down 10%+ in the latest year and not up the year before', () => {
		const debt = (a: number, b: number, c: number) =>
			years([{}, { borrowings: a }, { borrowings: b }, { borrowings: c }]);
		expect(passes('deleverage', { annual: debt(500, 450, 400) })).toBe(true);
		expect(passes('deleverage', { annual: debt(500, 450, 410) })).toBe(false); // -8.9%
		expect(passes('deleverage', { annual: debt(400, 450, 400) })).toBe(false); // rose the year before
		expect(passes('deleverage', { annual: debt(500, 450, 400), industry: 'Housing Finance Company' })).toBe(false);
	});

	it('Super growth: quarter sales 20%+ and profit 25%+ YoY plus a 15%+ 3Y sales CAGR', () => {
		const annual = years([{ sales: 1000 }, {}, {}, { sales: 1600 }]); // 17% CAGR
		expect(passes('super-growth', { annual, quarters: quarters() })).toBe(true); // +30% / +40%
		expect(passes('super-growth', { annual, quarters: quarters({ sales: 119, netProfit: 14 }) })).toBe(false);
		expect(passes('super-growth', { annual, quarters: quarters({ netProfit: 12.4 }) })).toBe(false);
		expect(passes('super-growth', { annual: years([{ sales: 1000 }, {}, {}, { sales: 1300 }]), quarters: quarters() })).toBe(false);
	});

	it('never passes without metrics', () => {
		for (const id of ['high-roce', 'low-debt', 'opm-expansion', 'cagr-3y', 'heavy-capex', 'deleverage', 'super-growth'] as const) {
			expect(passesFundamentalPreset(id, null)).toBe(false);
			expect(passesFundamentalPreset(id, computeFundamentalMetrics({ quarters: [quarter('Jun 2026', 1, 1, 1)] }))).toBe(false);
		}
	});
});

describe('helpers', () => {
	it('recognises lenders by industry', () => {
		expect(isFinancialIndustry('Private Sector Bank')).toBe(true);
		expect(isFinancialIndustry('Life Insurance')).toBe(true);
		expect(isFinancialIndustry('Specialty Chemicals')).toBe(false);
		expect(isFinancialIndustry(null)).toBe(false);
	});

	it('explains a match in a line', () => {
		const m = computeFundamentalMetrics({ annual: years([{}, {}, {}, { roce: 22 }]), quarters: quarters() });
		expect(fundamentalDetail('high-roce', m)).toContain('ROCE 22.0%');
		expect(fundamentalDetail('opm-expansion', m)).toContain('+3.0 pts');
		expect(fundamentalDetail('low-debt', null)).toBe('');
	});
});
