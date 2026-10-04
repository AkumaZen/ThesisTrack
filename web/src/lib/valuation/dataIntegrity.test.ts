import { describe, it, expect } from 'vitest';
import { runIntegrityChecks, worstIntegrityStatus } from './dataIntegrity';

// Real AMANTA figures pulled and hand-verified against live Screener/scraper output earlier
// this session: CMP 190, Market Cap 738cr, shares 3.88cr, Stock P/E 48.1, latest year (Mar
// 2026) sales 288 / expenses 228 / interest 21 / otherIncome 1 / depreciation 19 / pbt 21 /
// tax 6 / netProfit 15 / eps 3.83. All five checks below were confirmed to compute 'ok'.
const amantaYear = {
	label: 'Mar 2026',
	sales: 288,
	expenses: 228,
	operatingProfit: 60,
	otherIncome: 1,
	interest: 21,
	depreciation: 19,
	pbt: 21,
	tax: 6,
	netProfit: 15,
	eps: 3.83
};

describe('runIntegrityChecks — real AMANTA data golden case', () => {
	it('every check passes for internally-consistent real data', () => {
		const checks = runIntegrityChecks({
			cmp: 190,
			marketCap: 738,
			shares: 3.88,
			stockPE: 48.1,
			years: [amantaYear],
			shareholding: { promoters: 63.79, fiis: 0.43, diis: 12.92, public: 22.84 }
		});
		expect(checks.length).toBeGreaterThan(0);
		expect(worstIntegrityStatus(checks)).toBe('ok');
	});
});

describe('runIntegrityChecks — individual identities', () => {
	it('flags a CMP x Shares vs Market Cap mismatch beyond the tolerance', () => {
		const checks = runIntegrityChecks({
			cmp: 100,
			marketCap: 5000, // implies ~50 shares, but we say 10 -> way off
			shares: 10,
			stockPE: null,
			years: [],
			shareholding: null
		});
		const check = checks.find((c) => c.label.includes('Market Cap'));
		expect(check?.status).toBe('fail');
	});

	it('passes the market cap check within a small rounding tolerance', () => {
		const checks = runIntegrityChecks({
			cmp: 100,
			marketCap: 1000, // exact: 100 * 10 = 1000
			shares: 10,
			stockPE: null,
			years: [],
			shareholding: null
		});
		const check = checks.find((c) => c.label.includes('Market Cap'));
		expect(check?.status).toBe('ok');
	});

	it('flags Sales - Expenses != Operating Profit as a scraper-consistency bug', () => {
		const checks = runIntegrityChecks({
			cmp: null,
			marketCap: null,
			shares: 0,
			stockPE: null,
			years: [{ ...amantaYear, operatingProfit: 999 }], // sales-expenses=60, but OP says 999
			shareholding: null
		});
		const check = checks.find((c) => c.label.includes('Operating Profit ('));
		expect(check?.status).toBe('fail');
	});

	it('flags PBT - Tax != Net Profit', () => {
		const checks = runIntegrityChecks({
			cmp: null,
			marketCap: null,
			shares: 0,
			stockPE: null,
			years: [{ ...amantaYear, netProfit: 5 }], // pbt(21) - tax(6) = 15, not 5
			shareholding: null
		});
		const check = checks.find((c) => c.label.startsWith('PBT'));
		expect(check?.status).toBe('fail');
	});

	it('flags shareholding categories summing past 100% as a hard error', () => {
		const checks = runIntegrityChecks({
			cmp: null,
			marketCap: null,
			shares: 0,
			stockPE: null,
			years: [],
			shareholding: { promoters: 60, fiis: 30, diis: 20, public: 10 } // sums to 120%
		});
		const check = checks.find((c) => c.label.includes('Shareholding'));
		expect(check?.status).toBe('fail');
	});

	it('treats an incomplete shareholding sum (<60%, missing Govt/Others bucket) as a warning, not a failure', () => {
		const checks = runIntegrityChecks({
			cmp: null,
			marketCap: null,
			shares: 0,
			stockPE: null,
			years: [],
			shareholding: { promoters: 30, fiis: 5, diis: 5, public: 10 } // sums to 50%
		});
		const check = checks.find((c) => c.label.includes('Shareholding'));
		expect(check?.status).toBe('warn');
	});

	it('skips checks cleanly when required fields are null rather than throwing', () => {
		const checks = runIntegrityChecks({
			cmp: null,
			marketCap: null,
			shares: 0,
			stockPE: null,
			years: [],
			shareholding: null
		});
		expect(checks).toEqual([]);
	});
});

describe('worstIntegrityStatus', () => {
	it('escalates to fail if any check fails, even if others pass', () => {
		expect(
			worstIntegrityStatus([
				{ label: 'a', expected: 1, actual: 1, deltaPct: 0, status: 'ok', detail: '' },
				{ label: 'b', expected: 1, actual: 2, deltaPct: 100, status: 'fail', detail: '' }
			])
		).toBe('fail');
	});

	it('is ok when the check list is empty', () => {
		expect(worstIntegrityStatus([])).toBe('ok');
	});
});
