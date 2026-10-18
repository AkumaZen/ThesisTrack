import { describe, expect, it } from 'vitest';
import { actionSummary, classifyAction, dividendStats, parseCorporateActions } from './corporateActions';

const row = (symbol: string, exDate: string, subject: string, extra: Record<string, unknown> = {}) => ({
	symbol, comp: `${symbol} Limited`, exDate, recDate: exDate, subject, series: 'EQ', faceVal: '10', isin: 'INE000A01010', ...extra
});

describe('classifyAction', () => {
	it('reads dividends, adding a special dividend', () => {
		expect(classifyAction('Dividend - Rs 6 Per Share')).toEqual({ kind: 'dividend', amount: 6, ratio: null });
		expect(classifyAction('Interim Dividend - Re 0.50 Per Share')).toMatchObject({ kind: 'dividend', amount: 0.5 });
		expect(classifyAction('Dividend - Rs 14 Per Share/Special Dividend - Rs 6 Per Share')).toMatchObject({ amount: 20 });
		expect(classifyAction('Dividend - Rs1.25 Per Share')).toMatchObject({ amount: 1.25 });
		expect(classifyAction(' Dividend - Rs. 7.50 Per Share')).toMatchObject({ amount: 7.5 });
	});
	it('reads splits, bonus, rights, buyback and the rest', () => {
		expect(classifyAction('Face Value Split (Sub-Division) - From Rs 5/- Per Share To Re 1/- Per Share')).toEqual({ kind: 'split', amount: null, ratio: '5 to 1' });
		expect(classifyAction('Bonus 1:10')).toEqual({ kind: 'bonus', amount: null, ratio: '1:10' });
		expect(classifyAction('Rights 2:21 @ Premium Rs 748/-')).toEqual({ kind: 'rights', amount: 748, ratio: '2:21' });
		expect(classifyAction('Buy Back').kind).toBe('buyback');
		expect(classifyAction('Demerger').kind).toBe('other');
		expect(classifyAction('Distribution - Rs 5.40 Per Unit Consisting Of Interest - Rs 1.59 Per Unit')).toMatchObject({ kind: 'distribution', amount: 5.4 });
	});
});

describe('parseCorporateActions', () => {
	it('parses rows, skips bonds and unreadable rows, and keys by symbol, date and subject', () => {
		const rows = parseCorporateActions([
			row('ITC', '27-May-2026', 'Dividend - Rs 8 Per Share', { recDate: '28-May-2026' }),
			row('GOI', '07-Jan-2026', 'Interest Payment', { series: 'GS' }),
			row('X', '-', 'Dividend - Rs 1 Per Share', { recDate: '-' }),
			row('Y', '01-Oct-2026', 'Bonus 1:10', { faceVal: '-' }),
			null
		]);
		expect(rows.map((r) => r.nseSymbol)).toEqual(['ITC', 'Y']);
		expect(rows[0]).toMatchObject({ kind: 'dividend', amount: 8, exDate: '2026-05-27', recordDate: '2026-05-28', faceValue: 10, dedupeKey: 'ca:ITC|2026-05-27|dividend - rs 8 per share' });
		expect(rows[1]).toMatchObject({ kind: 'bonus', faceValue: null });
		expect(parseCorporateActions({ nothing: 1 })).toEqual([]);
	});
});

describe('dividendStats', () => {
	const history = [
		{ exDate: '2026-05-27', kind: 'dividend', amount: 8 },
		{ exDate: '2026-02-04', kind: 'dividend', amount: 6.5 },
		{ exDate: '2025-05-28', kind: 'dividend', amount: 7.85 },
		{ exDate: '2025-02-12', kind: 'dividend', amount: 6.5 },
		{ exDate: '2025-01-06', kind: 'other', amount: null },
		{ exDate: '2026-12-01', kind: 'dividend', amount: 99 } // not yet ex: ignored
	];
	it('sums the last 12 months, computes the yield on the stored price and the payout on EPS', () => {
		const s = dividendStats(history, 400, '2026-10-18', [{ label: 'Mar 2026', eps: 16 }, { label: 'Mar 2025', eps: null }]);
		expect(s.ttmPerShare).toBe(14.5);
		expect(s.yieldPct).toBe(3.63);
		expect(s.last).toEqual({ exDate: '2026-05-27', amount: 8 });
		expect(s.years[0]).toEqual({ fy: 'FY2027', perShare: 8, eps: null, payoutPct: null });
		expect(s.years[1]).toEqual({ fy: 'FY2026', perShare: 14.35, eps: 16, payoutPct: 89.7 });
	});
	it('has no yield without a price and no figures without dividends', () => {
		expect(dividendStats(history, null, '2026-10-18').yieldPct).toBeNull();
		expect(dividendStats([], 100, '2026-10-18')).toEqual({ ttmPerShare: 0, yieldPct: null, last: null, years: [] });
	});
});

describe('actionSummary', () => {
	it('words the common actions', () => {
		expect(actionSummary({ kind: 'dividend', amount: 6, ratio: null, subject: 's' })).toBe('Dividend Rs 6 per share');
		expect(actionSummary({ kind: 'split', amount: null, ratio: '10 to 2', subject: 's' })).toBe('Split, face value Rs 10 to Rs 2');
		expect(actionSummary({ kind: 'other', amount: null, ratio: null, subject: 'Demerger' })).toBe('Demerger');
	});
});
