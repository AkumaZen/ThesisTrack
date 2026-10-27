import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/server/db', () => ({ db: {} }));

import {
	decide,
	emptyState,
	refreshLiveBatch,
	runIntradaySlice,
	type IntradayDeps,
	type PassState
} from './intradayPrices';

// 2026-10-27 is a Tuesday, 2026-10-24 a Saturday. India time is UTC+5:30.
const ist = (hhmm: string, date = '2026-10-27') => new Date(`${date}T${hhmm}:00+05:30`);

const quote = (symbol: string) => ({ symbol, date: '2026-10-27', open: 1, high: 2, low: 1, ltp: 2, prevClose: 1, volume: 10 });

function setup(
	opts: { cache?: string[]; breadth?: string[]; state?: PassState; at?: string; failStep?: 'cards' | 'market'; onQuote?: () => void } = {}
) {
	let stored: string | null = opts.state ? JSON.stringify(opts.state) : null;
	const meta = new Map<string, string>();
	const quoted: string[][] = [];
	const refreshed: string[][] = [];
	const applied: string[][] = [];
	const steps: string[] = [];
	const deps: Partial<IntradayDeps> = {
		now: () => ist(opts.at ?? '13:00'),
		getMeta: async (key) => (key === 'intraday_prices' ? stored : (meta.get(key) ?? null)),
		setMeta: async (key, value) => {
			if (key === 'intraday_prices') stored = value;
			else meta.set(key, value);
		},
		acquire: async () => true,
		release: async () => {},
		listSymbols: async () => opts.cache ?? ['TCS', 'INFY'],
		listBreadthSymbols: async () => opts.breadth ?? ['INFY', 'ZEE', 'AAA'],
		refreshBenchmark: async () => {},
		readBreadthTips: async () => [],
		fetchQuotes: (async (symbols: string[]) => {
			quoted.push(symbols);
			opts.onQuote?.();
			return { quotes: new Map(symbols.map((s) => [s.toUpperCase(), quote(s.toUpperCase())])), unlisted: [], missing: [] };
		}) as IntradayDeps['fetchQuotes'],
		refreshBatch: (async (symbols: string[], overrides: { fetchQuotes?: (s: string[]) => Promise<unknown> } = {}) => {
			refreshed.push(symbols);
			// The shared quote result is handed over instead of a second request.
			const got = (await overrides.fetchQuotes?.(symbols)) as { quotes: Map<string, unknown> } | undefined;
			return {
				results: symbols.map((symbol) => ({ symbol, outcome: got?.quotes.has(symbol) ? 'appended' : 'unchanged' })),
				quoteCalls: 0,
				fullFetches: 0
			};
		}) as unknown as IntradayDeps['refreshBatch'],
		applyBreadthQuotes: (async (symbols: string[]) => {
			applied.push(symbols);
			return { appended: symbols.length, replaced: 0, stale: 0 };
		}) as IntradayDeps['applyBreadthQuotes'],
		refreshBreadthCards: async () => {
			steps.push('cards');
			if (opts.failStep === 'cards') throw new Error('boom');
		},
		recomputeBreadthMarket: async () => {
			steps.push('market');
			if (opts.failStep === 'market') throw new Error('boom');
		}
	};
	return { deps, quoted, refreshed, applied, steps, state: () => JSON.parse(stored ?? 'null') as PassState | null };
}

afterEach(() => vi.useRealTimers());

describe('pass universe', () => {
	it('walks the deduped union of sector/scanner and breadth symbols in order, one quote request per batch', async () => {
		const s = setup();
		const r = await runIntradaySlice(s.deps);
		expect(r.status).toBe('completed');
		expect(r.symbols).toBe(4); // TCS, INFY, ZEE, AAA: INFY is in both lists
		expect(s.quoted).toEqual([['AAA', 'INFY', 'TCS', 'ZEE']]);
	});

	it('sends only series symbols to refreshBatch and only breadth symbols to the breadth store', async () => {
		const s = setup();
		await runIntradaySlice(s.deps);
		expect(s.refreshed).toEqual([['INFY', 'TCS']]);
		expect(s.applied).toEqual([['AAA', 'INFY', 'ZEE']]);
	});

	it('splits a big universe into batches of 50', async () => {
		const many = Array.from({ length: 120 }, (_, i) => `S${String(i).padStart(3, '0')}`);
		const s = setup({ cache: [], breadth: many });
		const r = await runIntradaySlice(s.deps);
		expect(s.quoted.map((q) => q.length)).toEqual([50, 50, 20]);
		expect(r.batches).toBe(3);
	});
});

describe('refreshLiveBatch', () => {
	it('does not fetch a symbol twice: refreshBatch receives the shared quote', async () => {
		const s = setup();
		const fetchQuotes = vi.fn(s.deps.fetchQuotes!);
		await refreshLiveBatch(
			['INFY', 'ZEE'],
			{ cache: new Set(['INFY']), breadth: new Set(['INFY', 'ZEE']), tips: [] },
			{ fetchQuotes, refreshBatch: s.deps.refreshBatch!, applyBreadthQuotes: s.deps.applyBreadthQuotes! }
		);
		expect(fetchQuotes).toHaveBeenCalledTimes(1);
		expect(s.applied).toEqual([['INFY', 'ZEE']]);
	});

	it('skips the breadth part but still refreshes prices when the quote request fails', async () => {
		const s = setup();
		const r = await refreshLiveBatch(
			['INFY'],
			{ cache: new Set(['INFY']), breadth: new Set(['INFY']), tips: [] },
			{
				fetchQuotes: async () => {
					throw new Error('rate limited');
				},
				refreshBatch: s.deps.refreshBatch!,
				applyBreadthQuotes: s.deps.applyBreadthQuotes!
			}
		);
		expect(s.refreshed).toEqual([['INFY']]);
		expect(s.applied).toEqual([]);
		expect(r.breadthError).toBe(false);
	});

	it('reports a failed breadth write without failing the batch', async () => {
		const s = setup();
		const r = await refreshLiveBatch(
			['ZEE'],
			{ cache: new Set(), breadth: new Set(['ZEE']), tips: [] },
			{
				fetchQuotes: s.deps.fetchQuotes!,
				refreshBatch: s.deps.refreshBatch!,
				applyBreadthQuotes: async () => {
					throw new Error('db down');
				}
			}
		);
		expect(r.breadthError).toBe(true);
	});
});

describe('breadth follow-up steps', () => {
	it('runs both recomputes in the slice that completes the pass when there is time', async () => {
		const s = setup();
		const r = await runIntradaySlice(s.deps);
		expect(r.status).toBe('completed');
		expect(r.stepsRun).toEqual(['cards', 'market']);
		expect(s.steps).toEqual(['cards', 'market']);
		expect(s.state()?.current).toBeNull();
		expect(s.state()?.lastCompletedAt).toBeTypeOf('number');
	});

	it('leaves the steps to the next slice when the budget is spent, and that slice runs only them', async () => {
		vi.useFakeTimers();
		// The (only) quote request "takes" 20 s, more than the 15 s slice budget.
		const s = setup({ cache: [], breadth: ['A', 'B', 'C'], onQuote: () => vi.setSystemTime(Date.now() + 20_000) });
		const first = await runIntradaySlice(s.deps, 15_000);
		expect(first.status).toBe('running');
		expect(first.stepsRun).toEqual([]);
		expect(first.stepsLeft).toEqual(['cards', 'market']);
		expect(s.state()?.current?.todo).toEqual(['cards', 'market']);
		expect(s.steps).toEqual([]);

		const quotedBefore = s.quoted.length;
		const second = await runIntradaySlice(s.deps);
		expect(second.status).toBe('completed');
		expect(second.batches).toBe(0);
		expect(s.quoted.length).toBe(quotedBefore); // the follow-up slice makes no quote request
		expect(s.steps).toEqual(['cards', 'market']);
		expect(s.state()?.current).toBeNull();
	});

	it('can split the two steps over two slices', async () => {
		vi.useFakeTimers();
		const s = setup({
			cache: [],
			breadth: ['A'],
			state: { ...emptyState(), current: { kind: 'live', day: '2026-10-27', startedAt: 0, cursor: 'A', todo: ['cards', 'market'] } }
		});
		s.deps.refreshBreadthCards = async () => {
			s.steps.push('cards');
			vi.setSystemTime(Date.now() + 20_000); // the first recompute eats the budget
		};
		const first = await runIntradaySlice(s.deps, 15_000);
		expect(first.status).toBe('running');
		expect(first.stepsRun).toEqual(['cards']);
		expect(s.state()?.current?.todo).toEqual(['market']);
		const second = await runIntradaySlice(s.deps);
		expect(second.status).toBe('completed');
		expect(s.steps).toEqual(['cards', 'market']);
	});

	it('does not throw when a step fails: it is dropped and the pass completes', async () => {
		const s = setup({ failStep: 'cards' });
		const r = await runIntradaySlice(s.deps);
		expect(r.status).toBe('completed');
		expect(r.error).toMatch(/cards/);
		expect(s.steps).toEqual(['cards', 'market']);
	});

	it('steps aside (busy) while a manual refresh holds the pass', async () => {
		const s = setup();
		await s.deps.setMeta!('prices_manual_until', String(ist('13:00').getTime() + 60_000));
		const r = await runIntradaySlice(s.deps);
		expect(r.status).toBe('busy');
		expect(s.quoted).toEqual([]);
	});

	it('steps aside when the lease is taken', async () => {
		const s = setup();
		const r = await runIntradaySlice({ ...s.deps, acquire: async () => false });
		expect(r.status).toBe('busy');
	});

	it('reports an error summary instead of throwing when the lists cannot be read', async () => {
		const s = setup();
		const r = await runIntradaySlice({
			...s.deps,
			listBreadthSymbols: async () => {
				throw new Error('db down');
			}
		});
		expect(r.status).toBe('error');
		expect(r.error).toBe('db down');
	});
});

describe('decide', () => {
	const cur = (kind: 'live' | 'settle', todo?: ('cards' | 'market')[]) => ({
		...emptyState(),
		current: { kind, day: '2026-10-27', startedAt: 0, cursor: 'X', todo }
	});

	it('resumes a pass inside its window', () => {
		expect(decide(cur('live'), ist('13:00'))).toEqual({ action: 'resume' });
	});

	it('resumes a pass past the live window only while breadth steps are pending', () => {
		expect(decide(cur('live', ['market']), ist('15:40')).action).toBe('resume');
		expect(decide(cur('live'), ist('15:40')).action).toBe('idle');
	});

	it('starts a live pass 30 minutes after the last, never at the weekend', () => {
		expect(decide({ ...emptyState(), lastLiveStartedAt: ist('12:35').getTime() }, ist('13:00')).action).toBe('idle');
		expect(decide({ ...emptyState(), lastLiveStartedAt: ist('12:30').getTime() }, ist('13:00')).action).toBe('start');
		expect(decide(emptyState(), ist('13:00', '2026-10-24')).action).toBe('idle');
	});

	it('starts one settle pass after 16:00', () => {
		expect(decide(emptyState(), ist('16:05'))).toEqual({ action: 'start', kind: 'settle' });
		expect(decide({ ...emptyState(), lastSettleDay: '2026-10-27' }, ist('16:05')).action).toBe('idle');
	});
});
