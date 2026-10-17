import { describe, expect, it, vi } from 'vitest';

vi.mock('$lib/server/db', () => ({ db: {} }));
vi.mock('./companyGrowthSeries', () => ({ refreshCompanySeries: vi.fn() }));

import type { Candle, DayQuote } from './angelone';
import { refreshBatch } from './batchRefresh';

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
			now: () => NOW
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
});
