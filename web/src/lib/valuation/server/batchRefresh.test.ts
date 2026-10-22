import { describe, expect, it, vi } from 'vitest';

vi.mock('$lib/server/db', () => ({ db: {} }));
vi.mock('./companyGrowthSeries', () => ({ refreshCompanySeries: vi.fn() }));

import type { Candle, DayQuote } from './angelone';
import { FULL_REFRESH_CONCURRENCY, refreshBatch } from './batchRefresh';

const candle = (day: string, close: number): Candle => ({
	date: `${day}T00:00:00+05:30`,
	open: close,
	high: close,
	low: close,
	close,
	volume: 1
});
const quote = (symbol: string, date: string, extra: Partial<DayQuote> = {}): DayQuote => ({
	symbol,
	date,
	open: 101,
	high: 105,
	low: 99,
	ltp: 104,
	prevClose: 100,
	volume: 10,
	...extra
});
const NOW = new Date('2026-10-19T12:00:00Z');

function setup(opts: {
	stored: Record<string, Candle[]>;
	quotes?: Record<string, DayQuote>;
	unlisted?: string[];
	quoteError?: boolean;
	full?: (s: string) => Promise<unknown | null>;
	calendar?: string[] | null;
	now?: Date;
}) {
	const writes: { symbol: string; candles: Candle[] }[][] = [];
	const fetchQuotes = vi.fn(async (symbols: string[]) => {
		if (opts.quoteError) throw new Error('boom');
		const quotes = new Map(Object.entries(opts.quotes ?? {}).filter(([s]) => symbols.includes(s)));
		const unlisted = (opts.unlisted ?? []).filter((s) => symbols.includes(s));
		const missing = symbols.filter((s) => !quotes.has(s) && !unlisted.includes(s));
		return { quotes, unlisted, missing };
	});
	const fullRefresh = vi.fn(opts.full ?? (async () => ({ candles: [] })));
	return {
		writes,
		fetchQuotes,
		fullRefresh,
		deps: {
			readSeries: async (symbols: string[]) =>
				new Map(Object.entries(opts.stored).filter(([s]) => symbols.includes(s))),
			fetchQuotes,
			writeSeries: async (rows: { symbol: string; candles: Candle[] }[]) => void writes.push(rows),
			fullRefresh,
			readCalendar: async () => opts.calendar ?? null,
			now: () => opts.now ?? NOW
		}
	};
}

describe('refreshBatch', () => {
	it('maps each symbol to its outcome with one quote request and one write', async () => {
		const t = setup({
			stored: {
				AAA: [candle('2026-10-16', 100)], // a session behind: appended
				BBB: [candle('2026-10-19', 104)], // already current: unchanged
				CCC: [candle('2026-10-14', 100)], // gap: full
				DDD: [candle('2026-10-16', 100)], // unlisted
				EEE: [candle('2026-10-16', 100)] // corporate action: full
			},
			quotes: {
				AAA: quote('AAA', '2026-10-19'),
				BBB: quote('BBB', '2026-10-19'),
				CCC: quote('CCC', '2026-10-19'),
				EEE: quote('EEE', '2026-10-19', { open: 40, prevClose: 40, ltp: 41 })
			},
			unlisted: ['DDD']
		});
		const r = await refreshBatch(['aaa', 'BBB', 'CCC', 'DDD', 'EEE', 'NEW', 'AAA'], t.deps);
		expect(r.results.map((x) => `${x.symbol}:${x.outcome}`)).toEqual([
			'AAA:appended',
			'BBB:unchanged',
			'CCC:full',
			'DDD:unlisted',
			'EEE:full',
			'NEW:full'
		]);
		expect(r.results.find((x) => x.symbol === 'CCC')?.reason).toBe('gap');
		expect(r.results.find((x) => x.symbol === 'EEE')?.reason).toBe('corporate-action');
		expect(r.results.find((x) => x.symbol === 'NEW')?.reason).toBe('no stored series');
		expect(t.fetchQuotes).toHaveBeenCalledTimes(1);
		expect(t.writes).toHaveLength(1);
		expect(t.writes[0].map((w) => w.symbol)).toEqual(['AAA']);
		expect(t.fullRefresh.mock.calls.map((c) => c[0])).toEqual(['NEW', 'CCC', 'EEE']);
		expect(r).toMatchObject({ quoteCalls: 1, fullFetches: 3 });
	});

	it('reports unlisted when a full fetch finds no listing, and failed when it throws', async () => {
		const t = setup({
			stored: {},
			full: async (s) => {
				if (s === 'NOLIST') return null;
				if (s === 'BAD') throw new Error('ANGEL_HISTORICAL_FAILED');
				return {};
			}
		});
		const r = await refreshBatch(['OK', 'NOLIST', 'BAD'], t.deps);
		expect(r.results.map((x) => x.outcome)).toEqual(['full', 'unlisted', 'failed']);
		expect(t.fetchQuotes).not.toHaveBeenCalled();
	});

	it('falls back to full fetches when the quote call fails', async () => {
		const t = setup({ stored: { AAA: [candle('2026-10-16', 100)] }, quoteError: true });
		const r = await refreshBatch(['AAA'], t.deps);
		expect(r.results[0]).toMatchObject({ outcome: 'full', reason: 'quote unavailable' });
	});

	it('does a full fetch for a symbol the quote returned nothing for', async () => {
		const t = setup({ stored: { AAA: [candle('2026-10-16', 100)] } });
		const r = await refreshBatch(['AAA'], t.deps);
		expect(r.results[0]).toMatchObject({ outcome: 'full', reason: 'no quote' });
	});

	it('marks appended symbols failed when the batched write fails', async () => {
		const t = setup({ stored: { AAA: [candle('2026-10-16', 100)] }, quotes: { AAA: quote('AAA', '2026-10-19') } });
		const r = await refreshBatch(['AAA'], {
			...t.deps,
			writeSeries: async () => {
				throw new Error('db down');
			}
		});
		expect(r.results[0]).toMatchObject({ outcome: 'failed', reason: 'db down' });
	});

	// 2026-10-20 (Tuesday) is an exchange holiday: sessions ... 10-16, 10-19, 10-21.
	describe('exchange holiday between the last stored session and the quote day', () => {
		const holidayNow = new Date('2026-10-21T12:00:00Z');
		const calendar = ['2026-10-15', '2026-10-16', '2026-10-19', '2026-10-21'];
		const stored = { AAA: [candle('2026-10-19', 100)], BBB: [candle('2026-10-16', 100)] };
		const quotes = { AAA: quote('AAA', '2026-10-21'), BBB: quote('BBB', '2026-10-21') };

		it('appends when the benchmark calendar shows no session in between, and still refetches a real miss', async () => {
			const t = setup({ stored, quotes, calendar, now: holidayNow });
			const r = await refreshBatch(['AAA', 'BBB'], t.deps);
			expect(r.results.map((x) => `${x.symbol}:${x.outcome}`)).toEqual(['AAA:appended', 'BBB:full']);
			expect(r.fullFetches).toBe(1);
		});

		it('falls back to the weekday rule when the benchmark is missing', async () => {
			const t = setup({ stored, quotes, calendar: null, now: holidayNow });
			const r = await refreshBatch(['AAA'], t.deps);
			expect(r.results[0]).toMatchObject({ outcome: 'full', reason: 'gap' });
		});

		it('falls back to the weekday rule when the benchmark is stale', async () => {
			const t = setup({ stored, quotes, calendar: ['2026-10-15', '2026-10-16', '2026-10-19'], now: holidayNow });
			const r = await refreshBatch(['AAA'], t.deps);
			expect(r.results[0]).toMatchObject({ outcome: 'full', reason: 'gap' });
		});

		it('reads the calendar once per batch', async () => {
			const t = setup({ stored, quotes, calendar, now: holidayNow });
			const readCalendar = vi.fn(async () => calendar);
			await refreshBatch(['AAA', 'BBB'], { ...t.deps, readCalendar });
			expect(readCalendar).toHaveBeenCalledTimes(1);
		});

		it('survives a failing calendar read', async () => {
			const t = setup({ stored, quotes, now: holidayNow });
			const r = await refreshBatch(['AAA'], {
				...t.deps,
				readCalendar: async () => {
					throw new Error('db down');
				}
			});
			expect(r.results[0]).toMatchObject({ outcome: 'full', reason: 'gap' });
		});
	});

	it('runs full refetches with bounded concurrency and keeps the result order', async () => {
		let inFlight = 0;
		let peak = 0;
		const symbols = Array.from({ length: 10 }, (_, i) => `S${i}`);
		const t = setup({
			stored: {},
			full: async (s) => {
				inFlight++;
				peak = Math.max(peak, inFlight);
				// Later symbols finish first, so completion order differs from request order.
				await new Promise((r) => setTimeout(r, 20 - Number(s.slice(1))));
				inFlight--;
				if (s === 'S4') throw new Error('bad');
				return {};
			}
		});
		const r = await refreshBatch(symbols, t.deps);
		expect(peak).toBe(FULL_REFRESH_CONCURRENCY);
		expect(r.results.map((x) => x.symbol)).toEqual(symbols);
		expect(r.results[4]).toMatchObject({ outcome: 'failed', reason: 'bad' });
		expect(r.results.filter((x) => x.outcome === 'full')).toHaveLength(9);
		expect(r.fullFetches).toBe(10);
	});
});
