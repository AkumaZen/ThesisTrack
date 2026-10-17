import { describe, expect, it, vi } from 'vitest';

vi.mock('$lib/server/db', () => ({ db: {} }));
vi.mock('./sectorStore', () => ({ listAllSymbols: vi.fn() }));
vi.mock('./mcapUniverseStore', () => ({ listUniverseSymbols: vi.fn() }));
vi.mock('./batchRefresh', () => ({ BATCH_SIZE: 50, refreshBatch: vi.fn() }));
vi.mock('./benchmarkSeries', () => ({ refreshBenchmarkCandles: vi.fn() }));
vi.mock('./alertChecks', () => ({ runStructuralChecks: vi.fn() }));

import { buildRefreshQueue, capColdSymbols, MAX_COLD_PER_RUN } from './sectorRotationScheduler';

const HOUR = 3_600_000;

describe('buildRefreshQueue', () => {
	it('includes watchlist companies that are in no sector basket', () => {
		const q = buildRefreshQueue([['TCS', 'INFY'], ['HFCL', 'TCS']], new Map(), 100 * HOUR);
		expect(q.sort()).toEqual(['HFCL', 'INFY', 'TCS']);
	});
	it('de-duplicates case-insensitively', () => {
		expect(buildRefreshQueue([['tcs'], ['TCS']], new Map(), 100 * HOUR)).toEqual(['TCS']);
	});
	it('puts never-fetched symbols first, then the stalest', () => {
		const now = 100 * HOUR;
		const fetched = new Map([
			['AAA', now - 5 * HOUR],
			['BBB', now - 20 * HOUR]
		]);
		expect(buildRefreshQueue([['AAA', 'BBB', 'NEW']], fetched, now)).toEqual(['NEW', 'BBB', 'AAA']);
	});
	it('skips symbols fetched within the last half hour', () => {
		const now = 100 * HOUR;
		const fetched = new Map([['FRESH', now - 60_000]]);
		expect(buildRefreshQueue([['FRESH', 'OLD']], fetched, now)).toEqual(['OLD']);
	});
});

describe('buildRefreshQueue with the market cap universe', () => {
	it('adds universe symbols to the queue alongside baskets and watchlists, once each', () => {
		const q = buildRefreshQueue([['TCS'], ['HFCL'], ['TCS', 'RBLBANK']], new Map(), 100 * HOUR);
		expect(q.sort()).toEqual(['HFCL', 'RBLBANK', 'TCS']);
	});
});

describe('capColdSymbols', () => {
	const cold = Array.from({ length: 100 }, (_, i) => `C${i}`);

	it('leaves a queue alone when the cold symbols fit', () => {
		const out = capColdSymbols(['A', 'B', 'C0'], new Set(['A', 'B']), 5);
		expect(out).toEqual({ queue: ['A', 'B', 'C0'], deferred: 0 });
	});
	it('keeps every symbol that has a series and caps the ones without', () => {
		const warm = ['W1', 'W2'];
		const out = capColdSymbols([...warm, ...cold], new Set(warm), MAX_COLD_PER_RUN);
		expect(out.queue).toHaveLength(2 + MAX_COLD_PER_RUN);
		expect(out.queue.slice(0, 2)).toEqual(warm);
		expect(out.deferred).toBe(100 - MAX_COLD_PER_RUN);
	});
	it('never caps exempt symbols (baskets, watchlists)', () => {
		const out = capColdSymbols(cold, new Set(), 10, 0, new Set(['C99', 'C98']));
		expect(out.queue).toContain('C99');
		expect(out.queue).toContain('C98');
		expect(out.queue).toHaveLength(10 + 2);
	});
	it('moves the window on with rotateBy so the same slots are not held every run', () => {
		const a = capColdSymbols(cold, new Set(), 10, 0).queue;
		const b = capColdSymbols(cold, new Set(), 10, 10).queue;
		expect(a).toEqual(cold.slice(0, 10));
		expect(b).toEqual(cold.slice(10, 20));
	});
});
