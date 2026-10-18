import { describe, expect, it } from 'vitest';
import {
	addSymbolBreadth,
	advanceDeclineRatio,
	breadthRead,
	lastSessionDates,
	newBreadthRows,
	pct,
	emptyBreadthRow
} from './breadth';
import type { Candle } from './stageScan';

/** Sessions on consecutive calendar days (the dates only need to be unique and ordered). */
function series(closes: number[], spread = 0): Candle[] {
	const start = Date.UTC(2025, 0, 1);
	return closes.map((close, i) => ({
		date: new Date(start + i * 86_400_000).toISOString().slice(0, 10),
		open: close,
		high: close + spread,
		low: close - spread,
		close,
		volume: 1000
	}));
}

describe('lastSessionDates', () => {
	it('returns the newest n dates, oldest first', () => {
		expect(lastSessionDates(series([1, 2, 3, 4]), 2)).toEqual(['2025-01-03', '2025-01-04']);
	});
});

describe('addSymbolBreadth', () => {
	it('counts advances, declines and unchanged against the previous close', () => {
		const rows = newBreadthRows(['2025-01-04']);
		addSymbolBreadth(rows, series([10, 11, 12, 13])); // up
		addSymbolBreadth(rows, series([10, 11, 12, 11])); // down
		addSymbolBreadth(rows, series([10, 11, 12, 12])); // flat
		const r = rows.get('2025-01-04')!;
		expect([r.total, r.advances, r.declines, r.unchanged]).toEqual([3, 1, 1, 1]);
		expect(advanceDeclineRatio(r)).toBe(1);
	});

	it('judges the 50 and 200 day averages only with enough sessions', () => {
		const rising = series(Array.from({ length: 220 }, (_, i) => 100 + i)); // above both averages
		const falling = series(Array.from({ length: 220 }, (_, i) => 400 - i)); // below both
		const short = series(Array.from({ length: 60 }, (_, i) => 100 + i)); // 50 only
		const date = rising[219].date;
		const rows = newBreadthRows([date]);
		addSymbolBreadth(rows, rising);
		addSymbolBreadth(rows, falling);
		addSymbolBreadth(rows, short.map((c, i) => ({ ...c, date: rising[160 + i].date })));
		const r = rows.get(date)!;
		expect([r.withDma50, r.aboveDma50]).toEqual([3, 2]);
		expect([r.withDma200, r.aboveDma200]).toEqual([2, 1]);
	});

	it('flags a 52-week high and low only for stocks with a year of history', () => {
		const up = series(Array.from({ length: 260 }, (_, i) => 100 + i), 1);
		const down = series(Array.from({ length: 260 }, (_, i) => 500 - i), 1);
		const fresh = series(Array.from({ length: 30 }, (_, i) => 100 + i), 1);
		const date = up[259].date;
		const rows = newBreadthRows([date]);
		addSymbolBreadth(rows, up);
		addSymbolBreadth(rows, down);
		addSymbolBreadth(rows, fresh.map((c, i) => ({ ...c, date: up[230 + i].date })));
		const r = rows.get(date)!;
		expect(r.highs52w).toBe(1);
		expect(r.lows52w).toBe(1);
		expect(r.total).toBe(3);
	});

	it('skips dates a symbol has no previous session for or no candle on', () => {
		const rows = newBreadthRows(['2025-01-01', '2026-01-01']);
		addSymbolBreadth(rows, series([10, 11]));
		expect(rows.get('2025-01-01')!.total).toBe(0); // first candle has no previous close
		expect(rows.get('2026-01-01')!.total).toBe(0);
		addSymbolBreadth(rows, series([5])); // too short to use
		expect(rows.get('2025-01-01')!.total).toBe(0);
	});
});

describe('helpers', () => {
	it('pct handles an empty whole', () => {
		expect(pct(1, 4)).toBe(25);
		expect(pct(0, 0)).toBeNull();
	});
	it('reads the latest row from the share above the 200 day average', () => {
		const row = (above: number, of: number) => ({ ...emptyBreadthRow('d'), aboveDma200: above, withDma200: of });
		expect(breadthRead(row(70, 100))).toBe('strong');
		expect(breadthRead(row(50, 100))).toBe('mixed');
		expect(breadthRead(row(30, 100))).toBe('weak');
		expect(breadthRead(row(0, 0))).toBe('no data');
	});
});
