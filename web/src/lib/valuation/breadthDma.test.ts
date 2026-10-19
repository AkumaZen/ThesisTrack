import { describe, expect, it } from 'vitest';
import {
	addSymbolDma,
	buildBreadthUniverse,
	candlesToSeries,
	commonLastDay,
	dayToIso,
	isFundName,
	isoToDay,
	MIN_ELIGIBLE,
	pctOf,
	planBackfill,
	planDailyAppend,
	publishableRows,
	type ClosesStatus,
	type DmaRow,
	type QuotePoint
} from './breadthDma';

const D0 = isoToDay('2025-01-06'); // a Monday
const rowsFor = (days: number[], closes: number[], since = 0) => {
	const rows = new Map<number, DmaRow>();
	addSymbolDma(rows, days, closes, since);
	return rows;
};
const consecutive = (n: number, start = D0) => Array.from({ length: n }, (_, i) => start + i);

describe('day conversion', () => {
	it('round trips ISO dates', () => {
		expect(dayToIso(isoToDay('2026-10-19'))).toBe('2026-10-19');
		expect(isoToDay('2026-10-19T00:00:00+05:30')).toBe(isoToDay('2026-10-19'));
	});
});

describe('addSymbolDma eligibility warmup', () => {
	it('counts a symbol only from its 50th close', () => {
		const closes = Array.from({ length: 60 }, () => 100);
		const days = consecutive(60);
		const rows = rowsFor(days, closes);
		expect(rows.get(days[48])!.eligible50).toBe(0);
		expect(rows.get(days[49])!.eligible50).toBe(1);
		expect(rows.get(days[59])!.eligible50).toBe(1);
		// 200 DMA needs 200 closes: never eligible here.
		expect(rows.get(days[59])!.eligible200).toBe(0);
	});

	it('is below only when strictly under the 50 session average (a close on the average is not below)', () => {
		const flat = rowsFor(consecutive(50), Array(50).fill(100));
		expect(flat.get(D0 + 49)!.below50).toBe(0);
		// 49 closes at 100 then a drop to 50: average 99, close under it.
		const drop = rowsFor(consecutive(50), [...Array(49).fill(100), 50]);
		expect(drop.get(D0 + 49)!.below50).toBe(1);
		const rise = rowsFor(consecutive(50), [...Array(49).fill(100), 150]);
		expect(rise.get(D0 + 49)!.below50).toBe(0);
	});

	it('uses a rolling window: old closes leave the average', () => {
		// 50 closes at 10, then 50 at 100: on the last day the average is 100, close equal: not below.
		const closes = [...Array(50).fill(10), ...Array(50).fill(100)];
		const rows = rowsFor(consecutive(100), closes);
		expect(rows.get(D0 + 99)!.below50).toBe(0);
		// Right after the jump (day 50) the average is 11.8 and the close 100: above.
		expect(rows.get(D0 + 50)!.below50).toBe(0);
		// Reverse: high then low.
		const rev = rowsFor(consecutive(60), [...Array(50).fill(100), ...Array(10).fill(10)]);
		expect(rev.get(D0 + 59)!.below50).toBe(1);
	});

	it('computes the 200 DMA with its own warmup', () => {
		const closes = [...Array(199).fill(100), 10];
		const rows = rowsFor(consecutive(200), closes);
		const r = rows.get(D0 + 199)!;
		expect([r.eligible200, r.below200, r.eligible50, r.below50]).toEqual([1, 1, 1, 1]);
		expect(rows.get(D0 + 198)!.eligible200).toBe(0);
	});

	it("averages over the symbol's own sessions, so gaps and holidays do not matter", () => {
		// Days skip weekends/holidays (irregular), the average still runs over 50 closes.
		const days = Array.from({ length: 55 }, (_, i) => D0 + i + Math.floor(i / 5) * 2);
		const closes = [...Array(54).fill(100), 40];
		const rows = rowsFor(days, closes);
		expect(rows.get(days[54])!.below50).toBe(1);
		// A date nobody traded has no row at all.
		expect(rows.has(days[4] + 1)).toBe(false);
	});

	it('counts only the days from sinceDay but still warms up on earlier ones', () => {
		const days = consecutive(80);
		const rows = rowsFor(days, Array(80).fill(100), days[60]);
		expect([...rows.keys()].sort((a, b) => a - b)[0]).toBe(days[60]);
		expect(rows.get(days[60])!.eligible50).toBe(1);
	});

	it('sums over several symbols; a symbol with too few closes is not eligible', () => {
		const rows = new Map<number, DmaRow>();
		const days = consecutive(50);
		addSymbolDma(rows, days, [...Array(49).fill(100), 50], 0); // below
		addSymbolDma(rows, days, [...Array(49).fill(100), 150], 0); // above
		addSymbolDma(rows, days.slice(10), Array(40).fill(100), 0); // too short: not eligible
		const r = rows.get(D0 + 49)!;
		expect([r.eligible50, r.below50]).toEqual([2, 1]);
		expect(pctOf(r.below50, r.eligible50)).toBe(50);
		expect(pctOf(0, 0)).toBeNull();
	});
});

describe('publishableRows', () => {
	it('drops days with too few eligible stocks and sorts oldest first', () => {
		const rows = new Map<number, DmaRow>([
			[5, { day: 5, eligible50: MIN_ELIGIBLE, below50: 1, eligible200: 0, below200: 0 }],
			[3, { day: 3, eligible50: MIN_ELIGIBLE - 1, below50: 1, eligible200: 0, below200: 0 }],
			[4, { day: 4, eligible50: MIN_ELIGIBLE + 5, below50: 1, eligible200: 0, below200: 0 }]
		]);
		expect(publishableRows(rows).map((r) => r.day)).toEqual([4, 5]);
	});
});

describe('universe', () => {
	const e = (name: string, series: string, exch = 'NSE') => ({ token: name + series, symbol: `${name}-${series}`, name, exch_seg: exch });
	it('keeps EQ and BE, prefers EQ, drops SME, debt, other exchanges and funds', () => {
		const u = buildBreadthUniverse([
			e('RELIANCE', 'EQ'),
			e('ZENITH', 'BE'),
			e('ZENITH', 'EQ'),
			e('TRADETOTRADE', 'BE'),
			e('SMESTOCK', 'SM'),
			e('GOVBOND', 'GS'),
			e('REITX', 'RR'),
			e('NIFTYBEES', 'EQ'),
			e('GOLDBEES', 'EQ'),
			e('011NSETEST', 'EQ'),
			e('BSEONLY', 'EQ', 'BSE'),
			{ token: '1', symbol: 'RELIANCE26OCTFUT', name: 'RELIANCE', exch_seg: 'NFO' }
		]);
		expect(u.map((x) => x.symbol)).toEqual(['RELIANCE', 'TRADETOTRADE', 'ZENITH']);
		expect(u.find((x) => x.symbol === 'ZENITH')!.token).toBe('ZENITHEQ');
	});

	it('tells funds from companies by name', () => {
		for (const f of ['NIFTYBEES', 'LIQUIDBEES', 'SETFNIF50', 'MIDCAPIETF', 'GOLDBEES', 'SILVERCASE', 'GILT5YBEES', 'HDFCSENSEX', 'MOM100', 'PSUBNKBEES', 'BANKBETF', 'EBBETF0431'])
			expect(isFundName(f), f).toBe(true);
		for (const c of ['RELIANCE', 'YESBANK', 'DHANBANK', 'J&KBANK', 'UNIONBANK', 'GOLDIAM', 'SUNPHARMA', 'HDFCBANK', 'SHRADDHA', 'BAJAJ-AUTO', 'TATAMOTORS', 'JSWINFRA', 'MAHABANK'])
			expect(isFundName(c), c).toBe(false);
	});
});

describe('planBackfill (resume)', () => {
	const universe = ['A', 'B', 'C', 'D', 'E'].map((symbol) => ({ symbol, token: symbol, exch: 'NSE' }));
	it('fetches what has no row and what is stale; skips done and empty', () => {
		const existing = new Map<string, ClosesStatus>([['A', 'done'], ['B', 'stale'], ['C', 'empty'], ['D', 'failed']]);
		expect(planBackfill(universe, existing, false).map((u) => u.symbol)).toEqual(['B', 'E']);
	});
	it('retries failed symbols only when asked', () => {
		const existing = new Map<string, ClosesStatus>([['D', 'failed']]);
		expect(planBackfill(universe, existing, true).map((u) => u.symbol)).toEqual(['A', 'B', 'C', 'D', 'E']);
	});
	it('is empty when everything is stored', () => {
		const existing = new Map<string, ClosesStatus>(universe.map((u) => [u.symbol, 'done']));
		expect(planBackfill(universe, existing, true)).toEqual([]);
	});
});

describe('candlesToSeries', () => {
	it('drops weekend-dated and invalid candles, dedupes days and sorts', () => {
		const s = candlesToSeries([
			{ date: '2026-10-16T00:00:00+05:30', close: 11 }, // Friday
			{ date: '2026-10-17T00:00:00+05:30', close: 12 }, // Saturday
			{ date: '2026-10-15T00:00:00+05:30', close: 10 },
			{ date: '2026-10-14T00:00:00+05:30', close: 0 },
			{ date: '2026-10-15T00:00:00+05:30', close: 10.5 }
		]);
		expect(s.days.map(dayToIso)).toEqual(['2026-10-15', '2026-10-16']);
		expect(s.closes).toEqual([10.5, 11]);
	});
});

describe('planDailyAppend', () => {
	const mon = isoToDay('2026-10-19');
	const fri = isoToDay('2026-10-16');
	const thu = isoToDay('2026-10-15');
	const q = (iso: string, price: number): QuotePoint => ({ day: isoToDay(iso), iso, price });

	it('appends a newer session and settles the same-day close', () => {
		const tips = [
			{ symbol: 'A', lastDay: fri },
			{ symbol: 'B', lastDay: mon }
		];
		const plan = planDailyAppend(tips, new Map([['A', q('2026-10-19', 10)], ['B', q('2026-10-19', 20)]]));
		expect(plan.append).toEqual([{ symbol: 'A', day: mon, close: 10 }]);
		expect(plan.replace).toEqual([{ symbol: 'B', day: mon, close: 20 }]);
	});

	it('skips weekend-dated quotes, older quotes and symbols without a quote', () => {
		const tips = ['A', 'B', 'C'].map((symbol) => ({ symbol, lastDay: fri }));
		const plan = planDailyAppend(tips, new Map([['A', q('2026-10-17', 10)], ['B', q('2026-10-15', 20)]]));
		expect(plan.append).toEqual([]);
		expect(plan.replace).toEqual([]);
		expect(plan.skipped).toEqual({ noQuote: 1, weekend: 1, old: 1 });
	});

	it('marks a symbol that missed a session stale instead of appending across the hole', () => {
		const tips = [
			{ symbol: 'OK1', lastDay: fri },
			{ symbol: 'OK2', lastDay: fri },
			{ symbol: 'LATE', lastDay: thu }
		];
		const quotes = new Map(tips.map((t) => [t.symbol, q('2026-10-19', 5)]));
		const plan = planDailyAppend(tips, quotes);
		expect(plan.stale).toEqual(['LATE']);
		expect(plan.append.map((a) => a.symbol)).toEqual(['OK1', 'OK2']);
	});

	it('leaves a suspended symbol (old quote) alone', () => {
		const tips = [
			{ symbol: 'OK', lastDay: fri },
			{ symbol: 'SUSP', lastDay: thu }
		];
		const plan = planDailyAppend(tips, new Map([['OK', q('2026-10-19', 5)], ['SUSP', q('2026-10-15', 7)]]));
		expect(plan.stale).toEqual([]);
		expect(plan.replace.map((r) => r.symbol)).toEqual(['SUSP']);
	});

	it('a rerun after a partial day appends the stragglers instead of refetching them', () => {
		const tips = [
			{ symbol: 'DONE1', lastDay: mon },
			{ symbol: 'DONE2', lastDay: mon },
			{ symbol: 'DONE3', lastDay: mon },
			{ symbol: 'LEFT', lastDay: fri }
		];
		const plan = planDailyAppend(tips, new Map(tips.map((t) => [t.symbol, q('2026-10-19', 5)])));
		expect(plan.stale).toEqual([]);
		expect(plan.append.map((a) => a.symbol)).toEqual(['LEFT']);
	});

	it('commonLastDay picks the mode', () => {
		expect(commonLastDay([{ symbol: 'a', lastDay: 1 }, { symbol: 'b', lastDay: 2 }, { symbol: 'c', lastDay: 2 }])).toBe(2);
		expect(commonLastDay([])).toBeNull();
	});
});
