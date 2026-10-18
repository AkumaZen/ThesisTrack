import { describe, expect, it } from 'vitest';
import {
	chartLines,
	periodReturnPct,
	periodStart,
	rebase,
	returnRows,
	weeklySeries,
	type ClosePoint,
	type ReturnItem
} from './returns';

const pts = (...pairs: [string, number][]): ClosePoint[] => pairs.map(([date, close]) => ({ date, close }));

describe('periodStart', () => {
	it('counts calendar months back', () => {
		expect(periodStart('2026-10-16', '1M')).toBe('2026-09-16');
		expect(periodStart('2026-10-16', '1Y')).toBe('2025-10-16');
		expect(periodStart('2026-10-16', '3Y')).toBe('2023-10-16');
	});
	it('clamps to the end of a shorter month', () => {
		expect(periodStart('2026-03-31', '1M')).toBe('2026-02-28');
		expect(periodStart('2024-05-31', '3M')).toBe('2024-02-29');
	});
});

describe('rebase and period return', () => {
	const s = pts(['2026-09-10', 200], ['2026-09-16', 250], ['2026-10-01', 275], ['2026-10-16', 300]);
	it('rebases to 100 at the last point on or before the start', () => {
		const r = rebase(s, '2026-09-16')!;
		r.map((p) => p.close).forEach((v, i) => expect(v).toBeCloseTo([100, 110, 120][i], 8));
		expect(r[0].date).toBe('2026-09-16');
	});
	it('uses the earlier point when the start falls between sessions', () => {
		const r = rebase(s, '2026-09-20')!;
		expect(r[0].date).toBe('2026-09-16');
	});
	it('returns the percent change over the window', () => {
		expect(periodReturnPct(s, '2026-09-16')).toBeCloseTo(20, 10);
	});
	it('is null when the series starts well after the period start', () => {
		expect(rebase(s, '2026-01-01')).toBeNull();
		expect(periodReturnPct(s, '2026-01-01')).toBeNull();
	});
	it('accepts a first point within a week of the start', () => {
		expect(rebase(s, '2026-09-05')).not.toBeNull();
	});
});

describe('returnRows and chartLines', () => {
	const stock: ReturnItem = {
		key: 'ABC',
		label: 'ABC',
		kind: 'stock',
		daily: pts(['2026-04-16', 100], ['2026-07-16', 120], ['2026-09-16', 150], ['2026-10-16', 180]),
		weekly: pts(['2023-10-16', 90], ['2026-10-16', 180])
	};
	const index: ReturnItem = {
		key: 'IDX:NIFTY50',
		label: 'Nifty 50',
		kind: 'index',
		daily: pts(['2026-04-16', 1000], ['2026-07-16', 1050], ['2026-09-16', 1100], ['2026-10-16', 1100]),
		weekly: pts(['2023-10-16', 800], ['2026-10-16', 1100])
	};
	it('computes returns per period and the excess over the benchmark', () => {
		const rows = returnRows([stock, index], 'IDX:NIFTY50');
		const s = rows.find((r) => r.key === 'ABC')!;
		expect(s.returns['1M']).toBeCloseTo(20, 8); // 150 -> 180
		expect(s.returns['6M']).toBeCloseTo(80, 8); // 100 -> 180
		expect(s.returns['3Y']).toBeCloseTo(100, 8); // 90 -> 180
		expect(s.returns['1Y']).toBeNull(); // the daily series only goes back six months
		expect(s.excess!['1M']).toBeCloseTo(20, 8); // the index is flat over 1M
		expect(rows.find((r) => r.key === 'IDX:NIFTY50')!.excess!['3Y']).toBe(0);
	});
	it('rebases every line to 100 and lists items that do not cover the period', () => {
		const { lines } = chartLines([stock, index], '6M');
		expect(lines.map((l) => l.points[0].close)).toEqual([100, 100]);
		expect(lines[0].points[lines[0].points.length - 1].close).toBeCloseTo(180, 8);
		const none = chartLines([stock, index], '1Y');
		expect(none.lines).toHaveLength(0);
		expect(none.skipped).toEqual(['ABC', 'Nifty 50']);
	});
	it('handles no items', () => {
		expect(returnRows([], null)).toEqual([]);
		expect(chartLines([], '1M').lines).toEqual([]);
	});
});

describe('weeklySeries', () => {
	it('keeps the last close of each Monday-to-Sunday week from the start date', () => {
		const candles = [
			{ date: '2026-09-28', close: 1 }, // Mon
			{ date: '2026-10-02', close: 2 }, // Fri
			{ date: '2026-10-05', close: 3 }, // Mon
			{ date: '2026-10-09', close: 4 }, // Fri
			{ date: '2026-10-12', close: 5 }
		];
		expect(weeklySeries(candles, '2026-09-28')).toEqual([
			{ date: '2026-10-02', close: 2 },
			{ date: '2026-10-09', close: 4 },
			{ date: '2026-10-12', close: 5 }
		]);
		expect(weeklySeries(candles, '2026-10-05').map((p) => p.close)).toEqual([4, 5]);
	});
});
