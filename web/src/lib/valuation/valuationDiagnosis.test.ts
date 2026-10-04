import { describe, it, expect } from 'vitest';
import { diagnoseValuationMethod } from './valuationDiagnosis';

const steadyYears = [
	{ label: 'Mar 2022', sales: 100, netProfit: 10 },
	{ label: 'Mar 2023', sales: 115, netProfit: 12 },
	{ label: 'Mar 2024', sales: 130, netProfit: 14 },
	{ label: 'Mar 2025', sales: 150, netProfit: 16 }
];

describe('diagnoseValuationMethod', () => {
	it('picks P/B for banks/NBFCs/insurers regardless of P&L shape', () => {
		const result = diagnoseValuationMethod({
			history: steadyYears,
			balanceSheet: null,
			cashConversionCycle: null,
			industry: 'Private Sector Bank'
		});
		expect(result.method).toBe('pb');
		expect(result.lowConfidence).toBe(false);
	});

	it('is case-insensitive and matches NBFC/insurance/housing finance too', () => {
		for (const industry of ['NBFC', 'Life Insurance', 'Housing Finance Company']) {
			expect(
				diagnoseValuationMethod({
					history: steadyYears,
					balanceSheet: null,
					cashConversionCycle: null,
					industry
				}).method
			).toBe('pb');
		}
	});

	it('falls back to low-confidence PE with fewer than 3 years of history', () => {
		const result = diagnoseValuationMethod({
			history: [{ label: 'Mar 2025', sales: 100, netProfit: 10 }],
			balanceSheet: null,
			cashConversionCycle: null,
			industry: null
		});
		expect(result.method).toBe('pe');
		expect(result.lowConfidence).toBe(true);
	});

	it('picks Mkt Cap/Sales when PAT is negative somewhere but sales still grew', () => {
		const history = [
			{ label: 'Mar 2022', sales: 100, netProfit: -5 },
			{ label: 'Mar 2023', sales: 130, netProfit: 2 },
			{ label: 'Mar 2024', sales: 160, netProfit: 8 }
		];
		const result = diagnoseValuationMethod({
			history,
			balanceSheet: null,
			cashConversionCycle: null,
			industry: null
		});
		expect(result.method).toBe('mcap_sales');
	});

	it('picks EV/EBITDA when PAT growth is highly volatile year to year', () => {
		const history = [
			{ label: 'Mar 2021', sales: 100, netProfit: 10 },
			{ label: 'Mar 2022', sales: 110, netProfit: 30 }, // +200%
			{ label: 'Mar 2023', sales: 120, netProfit: 5 }, // -83%
			{ label: 'Mar 2024', sales: 130, netProfit: 25 } // +400%
		];
		const result = diagnoseValuationMethod({
			history,
			balanceSheet: null,
			cashConversionCycle: null,
			industry: null
		});
		expect(result.method).toBe('ev_ebitda');
	});

	it('picks EV/EBITDA for asset-heavy balance sheets (borrowings > 35% of assets)', () => {
		const result = diagnoseValuationMethod({
			history: steadyYears,
			balanceSheet: { borrowings: 400, totalAssets: 1000 },
			cashConversionCycle: null,
			industry: null
		});
		expect(result.method).toBe('ev_ebitda');
		expect(result.reasons.join(' ')).toContain('40%');
	});

	it('picks EV/EBITDA for working-capital-heavy businesses (CCC > 120 days)', () => {
		const result = diagnoseValuationMethod({
			history: steadyYears,
			balanceSheet: null,
			cashConversionCycle: 200,
			industry: null
		});
		expect(result.method).toBe('ev_ebitda');
	});

	it('defaults to P/E for a clean, steady, profitable business', () => {
		const result = diagnoseValuationMethod({
			history: steadyYears,
			balanceSheet: { borrowings: 50, totalAssets: 1000 }, // 5%, not asset-heavy
			cashConversionCycle: 40,
			industry: 'Pharmaceuticals'
		});
		expect(result.method).toBe('pe');
		expect(result.lowConfidence).toBe(false);
	});

	it('sector classification takes priority over P&L-shape heuristics', () => {
		// A bank-like industry with volatile PAT should still land on P/B, not EV/EBITDA.
		const volatileHistory = [
			{ label: 'Mar 2021', sales: 100, netProfit: 10 },
			{ label: 'Mar 2022', sales: 110, netProfit: 40 },
			{ label: 'Mar 2023', sales: 120, netProfit: 5 }
		];
		const result = diagnoseValuationMethod({
			history: volatileHistory,
			balanceSheet: null,
			cashConversionCycle: null,
			industry: 'Public Sector Bank'
		});
		expect(result.method).toBe('pb');
	});
});
