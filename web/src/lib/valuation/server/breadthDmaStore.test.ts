import { describe, expect, it, vi } from 'vitest';

vi.mock('$lib/server/db', () => ({ db: {} }));

import { appendDailyBreadth, runBreadthBackfill, type SeriesRow } from './breadthDmaStore';
import type { Candle } from './angelone';
import type { ClosesStatus, UniverseScrip } from '../breadthDma';

const universe: UniverseScrip[] = ['A', 'B', 'C', 'D', 'E', 'F'].map((symbol) => ({ symbol, token: symbol, exch: 'NSE' }));
const candle = (date: string, close: number): Candle => ({ date: `${date}T00:00:00+05:30`, open: close, high: close, low: close, close, volume: 1 });

function backfillSetup(opts: {
	statuses?: Record<string, ClosesStatus>;
	candles?: (s: string) => Candle[] | Error;
	clock?: () => number;
}) {
	const saved: SeriesRow[] = [];
	const fetched: string[] = [];
	const recompute = vi.fn(async () => ({ rows: 3, latest: '2026-10-19' }));
	const deps = {
		listUniverse: async () => universe,
		readStatuses: async () => new Map(Object.entries(opts.statuses ?? {}) as [string, ClosesStatus][]),
		fetchCandles: async (s: UniverseScrip) => {
			fetched.push(s.symbol);
			const r = (opts.candles ?? (() => [candle('2026-10-15', 10), candle('2026-10-16', 11)]))(s.symbol);
			if (r instanceof Error) throw r;
			return r;
		},
		saveRows: async (rows: SeriesRow[]) => void saved.push(...rows),
		recompute,
		now: opts.clock ?? (() => 1_000)
	};
	return { deps, saved, fetched, recompute };
}

describe('runBreadthBackfill', () => {
	it('fetches every pending symbol, saves them and recomputes the aggregate when finished', async () => {
		const t = backfillSetup({});
		const r = await runBreadthBackfill({ budgetMs: 60_000 }, t.deps);
		expect(t.fetched.sort()).toEqual(['A', 'B', 'C', 'D', 'E', 'F']);
		expect(r).toMatchObject({ universe: 6, processed: 6, done: 6, failed: 0, remaining: 0, finished: true });
		expect(t.saved).toHaveLength(6);
		expect(t.saved[0].days).toHaveLength(2);
		expect(t.recompute).toHaveBeenCalledOnce();
	});

	it('resumes: skips symbols already stored and does nothing when all are', async () => {
		const t = backfillSetup({ statuses: { A: 'done', B: 'done', C: 'empty' } });
		await runBreadthBackfill({ budgetMs: 60_000 }, t.deps);
		expect(t.fetched.sort()).toEqual(['D', 'E', 'F']);
		const all = backfillSetup({ statuses: Object.fromEntries(universe.map((u) => [u.symbol, 'done'])) });
		const r = await runBreadthBackfill({ budgetMs: 60_000 }, all.deps);
		expect(r).toMatchObject({ processed: 0, remaining: 0, finished: true });
		expect(all.recompute).not.toHaveBeenCalled();
	});

	it('stops at the time budget with the rest remaining, and a later slice finishes the job', async () => {
		let now = 0;
		const t = backfillSetup({ clock: () => now });
		// Each fetch advances the clock 40 s: a 100 s budget leaves room for a few only.
		const advance = t.deps.fetchCandles;
		t.deps.fetchCandles = async (s) => {
			now += 40_000;
			return advance(s);
		};
		const first = await runBreadthBackfill({ budgetMs: 100_000 }, t.deps);
		expect(first.finished).toBe(false);
		expect(first.remaining).toBe(6 - first.processed);
		expect(first.processed).toBeGreaterThan(0);
		expect(t.recompute).not.toHaveBeenCalled();
		// Second slice: statuses now reflect what was saved.
		const statuses = Object.fromEntries(t.saved.map((s) => [s.symbol, s.status]));
		const t2 = backfillSetup({ statuses });
		const second = await runBreadthBackfill({ budgetMs: 60_000 }, t2.deps);
		expect(second.finished).toBe(true);
		expect(t.saved.length + t2.saved.length).toBe(6);
	});

	it('records a failing symbol and carries on; retries it only on request', async () => {
		const t = backfillSetup({ candles: (s) => (s === 'C' ? new Error('ANGEL_HISTORICAL_FAILED: HTTP 500') : [candle('2026-10-16', 5)]) });
		const r = await runBreadthBackfill({ budgetMs: 60_000 }, t.deps);
		expect(r).toMatchObject({ done: 5, failed: 1, finished: true });
		const bad = t.saved.find((s) => s.symbol === 'C')!;
		expect(bad.status).toBe('failed');
		expect(bad.error).toContain('HTTP 500');
		const again = backfillSetup({ statuses: { C: 'failed', A: 'done', B: 'done', D: 'done', E: 'done', F: 'done' } });
		await runBreadthBackfill({ budgetMs: 60_000 }, again.deps);
		expect(again.fetched).toEqual([]);
		await runBreadthBackfill({ budgetMs: 60_000, retryFailed: true }, again.deps);
		expect(again.fetched).toEqual(['C']);
	});

	it('marks a listed symbol with no candles as empty', async () => {
		const t = backfillSetup({ candles: (s) => (s === 'B' ? [] : [candle('2026-10-16', 5)]) });
		const r = await runBreadthBackfill({ budgetMs: 60_000 }, t.deps);
		expect(r.empty).toBe(1);
		expect(t.saved.find((s) => s.symbol === 'B')!.status).toBe('empty');
	});

	it('aborts on a login failure without marking symbols failed', async () => {
		const t = backfillSetup({ candles: () => new Error('ANGEL_AUTH_FAILED: HTTP 401') });
		const r = await runBreadthBackfill({ budgetMs: 60_000 }, t.deps);
		expect(r.aborted).toContain('ANGEL_AUTH_FAILED');
		expect(r.finished).toBe(false);
		expect(t.saved).toEqual([]);
		expect(r.remaining).toBe(6);
	});
});

describe('appendDailyBreadth', () => {
	const mon = Date.UTC(2026, 9, 19) / 86_400_000;
	const fri = mon - 3;
	type Plan = { append: unknown[]; replace: unknown[]; stale: string[] };
	const base = () => {
		const applied: Plan[] = [];
		return {
			applied,
			deps: {
				readTips: async () => [
					{ symbol: 'A', lastDay: fri },
					{ symbol: 'B', lastDay: fri },
					{ symbol: 'DELISTED', lastDay: fri - 30 }
				],
				fetchQuotes: async (symbols: string[]) => ({
					quotes: new Map(symbols.filter((s) => s !== 'DELISTED').map((s) => [s, { date: '2026-10-19', ltp: 12.5 }]))
				}),
				apply: async (p: Plan) => void applied.push(p),
				recompute: vi.fn(async () => ({ rows: 1, latest: '2026-10-19' }))
			}
		};
	};

	it('appends the newest close, leaves the delisted symbol alone and recomputes', async () => {
		const t = base();
		const r = await appendDailyBreadth(t.deps);
		expect(r).toMatchObject({ symbols: 3, appended: 2, replaced: 0, noQuote: 1, failedBatches: 0 });
		expect(t.applied[0].append).toHaveLength(2);
		expect(t.deps.recompute).toHaveBeenCalledOnce();
	});

	it('survives a failed quote batch (no changes, no recompute) instead of throwing', async () => {
		const t = base();
		t.deps.fetchQuotes = async () => {
			throw new Error('quote down');
		};
		const r = await appendDailyBreadth(t.deps);
		expect(r).toMatchObject({ appended: 0, failedBatches: 1, aggregate: null });
		expect(t.deps.recompute).not.toHaveBeenCalled();
	});

	it('ignores weekend-dated quotes', async () => {
		const t = base();
		t.deps.fetchQuotes = async (symbols: string[]) => ({
			quotes: new Map(symbols.map((s) => [s, { date: '2026-10-17', ltp: 9 }]))
		});
		const r = await appendDailyBreadth(t.deps);
		expect(r).toMatchObject({ appended: 0, weekend: 3 });
	});
});
