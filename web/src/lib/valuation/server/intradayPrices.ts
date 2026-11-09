// Keeps stored prices fresh during the trading day without anyone pressing Refresh. The
// every-minute cron (/api/cron/announcements) calls `runIntradaySlice`; each call works through a
// bounded slice of one "pass" over every sector symbol (quote path of refreshBatch), and a cursor in
// app_meta carries the pass over to the next minute until it completes. A new pass starts 30 minutes
// after the previous one started, from 09:15 to 15:30 IST on weekdays, plus one settle pass after
// 16:00 IST so the day's last candle stops being provisional. The nightly job and manual Refresh
// remain; a lease in app_meta keeps the passes from overlapping them.
//
// A pass covers the sector/scanner symbols AND the whole-market breadth list. Each batch of 50
// costs ONE quote request; that result feeds the stored price series (refreshBatch) and the
// breadth closes at once. When every symbol is done the pass still has two follow-up steps, the
// scanner-universe breadth cards and the whole-market chart aggregate. They are kept in the pass
// state, so a slice that runs out of time leaves them for the next minute's slice.
import { eq, sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { appMeta } from '$lib/server/db/valuationSchema';
import type { StoredTip } from '../breadthDma';
import { passUniverse } from '../livePass';
import { fetchDayQuotes } from './angelone';
import { BATCH_SIZE, refreshBatch } from './batchRefresh';
import { refreshBenchmarkCandles } from './benchmarkSeries';
import { applyBreadthQuotes, readBreadthTips, recomputeBreadthDma } from './breadthDmaStore';
import { refreshBreadth } from './breadthStore';
import { listBreadthUniverse } from './mcapUniverseStore';
import { istClock } from './refreshMerge';
import { getStageScanUniverse } from './stageScanUniverse';

export const PASS_EVERY_MS = 30 * 60_000;
/** A call stops starting batches after this long (the cron has its own time limits). */
export const SLICE_BUDGET_MS = 15_000;
export const MAX_BATCHES_PER_SLICE = 10;
/** Slow full refetches per batch; gaps are rare once holidays are known, the rest wait. */
export const MAX_FULL_PER_BATCH = 5;
/** A lease outlives the slice budget by a margin, so a crashed slice frees itself. */
const LEASE_MS = SLICE_BUDGET_MS + 30_000;
/** Manual Refresh all marks itself busy for this long after each batch. */
export const MANUAL_BUSY_MS = 2 * 60_000;

const STATE_KEY = 'intraday_prices';
const LEASE_KEY = 'prices_lease';
const MANUAL_KEY = 'prices_manual_until';

const LIVE_FROM = 9 * 60 + 15;
const LIVE_UNTIL = 15 * 60 + 30;
const SETTLE_FROM = 16 * 60;
const SETTLE_UNTIL = 19 * 60;

export type PassKind = 'live' | 'settle';

/** Follow-up steps once every symbol is done: the scanner-universe breadth rows (cards and table),
 *  then the whole-market DMA aggregate (chart). */
export type BreadthStep = 'cards' | 'market';

export interface PassState {
	/** The pass being worked through, if any. `cursor` is the last symbol done. `todo` appears once
	 *  every symbol is done: the breadth steps still to run (a later slice carries them on). */
	current: { kind: PassKind; day: string; startedAt: number; cursor: string | null; todo?: BreadthStep[] } | null;
	/** When the newest live pass started (the 30 minute cadence counts from it). */
	lastLiveStartedAt: number;
	/** IST day of the newest settle pass start. */
	lastSettleDay: string | null;
	/** When the newest pass (or nightly run) finished: what users see as "Updated". */
	lastCompletedAt: number | null;
}

export const emptyState = (): PassState => ({
	current: null,
	lastLiveStartedAt: 0,
	lastSettleDay: null,
	lastCompletedAt: null
});

/** Which pass kind the clock allows (weekdays only), ignoring what already ran. Holidays are not
 *  known ahead of the open: a pass on a holiday costs one cheap quote sweep that finds every symbol
 *  already current. */
export function windowKind(now: Date): PassKind | null {
	const ist = istClock(now);
	if (ist.weekday === 0 || ist.weekday === 6) return null;
	if (ist.minutes >= LIVE_FROM && ist.minutes <= LIVE_UNTIL) return 'live';
	if (ist.minutes >= SETTLE_FROM && ist.minutes < SETTLE_UNTIL) return 'settle';
	return null;
}

/** What this call should do: carry on the current pass, start a new one, or nothing. */
export function decide(
	state: PassState,
	now: Date
): { action: 'idle' } | { action: 'resume' } | { action: 'start'; kind: PassKind } {
	const kind = windowKind(now);
	const day = istClock(now).day;
	const cur = state.current;
	// A pass whose symbols are done but whose breadth steps are not may finish a little past its window.
	if (cur && cur.day === day && (cur.kind === kind || cur.todo?.length)) return { action: 'resume' };
	if (!kind) return { action: 'idle' };
	if (kind === 'live') {
		return now.getTime() - state.lastLiveStartedAt >= PASS_EVERY_MS ? { action: 'start', kind } : { action: 'idle' };
	}
	return state.lastSettleDay === day ? { action: 'idle' } : { action: 'start', kind };
}

export interface IntradayDeps {
	now: () => Date;
	getMeta: (key: string) => Promise<string | null>;
	setMeta: (key: string, value: string) => Promise<void>;
	/** True when the lease was free or expired and is now ours until `expiresAt`. */
	acquire: (key: string, now: number, expiresAt: number) => Promise<boolean>;
	release: (key: string) => Promise<void>;
	/** Sector and scanner symbols: the ones whose price series is stored. */
	listSymbols: () => Promise<string[]>;
	/** The whole-market breadth list: only their closes for the breadth chart are kept. */
	listBreadthSymbols: () => Promise<string[]>;
	refreshBenchmark: () => Promise<unknown>;
	refreshBatch: typeof refreshBatch;
	fetchQuotes: typeof fetchDayQuotes;
	readBreadthTips: () => Promise<StoredTip[]>;
	applyBreadthQuotes: typeof applyBreadthQuotes;
	/** Recomputes the scanner-universe breadth rows from the stored series. */
	refreshBreadthCards: () => Promise<unknown>;
	/** Recomputes the whole-market DMA aggregate from the stored closes. */
	recomputeBreadthMarket: () => Promise<unknown>;
}

export interface SliceSummary {
	status: 'idle' | 'busy' | 'running' | 'completed' | 'error';
	kind?: PassKind;
	batches: number;
	symbols: number;
	appended: number;
	fullFetches: number;
	deferred: number;
	failed: number;
	/** Breadth closes appended or settled by this slice, and batches whose breadth could not be applied. */
	breadthApplied: number;
	breadthErrors: number;
	/** Follow-up steps this slice ran, and the ones still waiting for the next slice. */
	stepsRun: BreadthStep[];
	stepsLeft: BreadthStep[];
	cursor?: string | null;
	ms: number;
	error?: string;
}

const realDeps: IntradayDeps = {
	now: () => new Date(),
	async getMeta(key) {
		const [row] = await db.select().from(appMeta).where(eq(appMeta.key, key));
		return row?.value ?? null;
	},
	async setMeta(key, value) {
		await db.insert(appMeta).values({ key, value }).onConflictDoUpdate({ target: appMeta.key, set: { value } });
	},
	async acquire(key, now, expiresAt) {
		const rows = await db
			.insert(appMeta)
			.values({ key, value: String(expiresAt) })
			.onConflictDoUpdate({
				target: appMeta.key,
				set: { value: String(expiresAt) },
				setWhere: sql`${appMeta.value}::bigint < ${now}`
			})
			.returning({ key: appMeta.key });
		return rows.length > 0;
	},
	async release(key) {
		await db.update(appMeta).set({ value: '0' }).where(eq(appMeta.key, key));
	},
	listSymbols: getStageScanUniverse,
	listBreadthSymbols: async () => (await listBreadthUniverse()).map((u) => u.symbol),
	refreshBenchmark: refreshBenchmarkCandles,
	refreshBatch,
	fetchQuotes: fetchDayQuotes,
	readBreadthTips,
	applyBreadthQuotes,
	refreshBreadthCards: refreshBreadth,
	recomputeBreadthMarket: () => recomputeBreadthDma()
};

export interface LiveBatchContext {
	/** Symbols that keep a stored price series (sector and scanner). */
	cache: Set<string>;
	/** Symbols of the whole-market breadth list. */
	breadth: Set<string>;
	/** Every stored breadth tip, to tell a missed session from a normal one. */
	tips: StoredTip[];
}

export interface LiveBatchResult {
	appended: number;
	deferred: number;
	failed: number;
	fullFetches: number;
	breadthApplied: number;
	breadthError: boolean;
}

/** The symbols a live pass covers, with which of them keep a price series and which are breadth. */
export async function loadLiveContext(deps: Pick<IntradayDeps, 'listSymbols' | 'listBreadthSymbols' | 'readBreadthTips'> = realDeps) {
	const [cacheList, breadthList] = await Promise.all([deps.listSymbols(), deps.listBreadthSymbols()]);
	const ctx: LiveBatchContext = {
		cache: new Set(cacheList.map((s) => s.toUpperCase())),
		breadth: new Set(breadthList.map((s) => s.toUpperCase())),
		tips: await deps.readBreadthTips().catch(() => [])
	};
	return { symbols: passUniverse(cacheList, breadthList), ctx };
}

/** One batch of up to BATCH_SIZE symbols: ONE quote request, whose result feeds both the stored
 *  price series (symbols in `cache`, through refreshBatch, cold ones capped) and the breadth closes
 *  (symbols in `breadth`). A failed quote request leaves the breadth alone and lets refreshBatch
 *  fall back as it always does; a failed breadth write never fails the price part. */
export async function refreshLiveBatch(
	batch: string[],
	ctx: LiveBatchContext,
	deps: Pick<IntradayDeps, 'fetchQuotes' | 'refreshBatch' | 'applyBreadthQuotes'> = realDeps
): Promise<LiveBatchResult> {
	const out: LiveBatchResult = { appended: 0, deferred: 0, failed: 0, fullFetches: 0, breadthApplied: 0, breadthError: false };
	let quoted: Awaited<ReturnType<typeof fetchDayQuotes>> | null = null;
	try {
		quoted = await deps.fetchQuotes(batch);
	} catch {
		quoted = null;
	}

	const cacheSymbols = batch.filter((s) => ctx.cache.has(s));
	if (cacheSymbols.length > 0) {
		const shared = quoted;
		const r = await deps.refreshBatch(
			cacheSymbols,
			shared
				? {
						fetchQuotes: async (symbols: string[]) => {
							const want = new Set(symbols.map((s) => s.toUpperCase()));
							return {
								quotes: new Map([...shared.quotes].filter(([s]) => want.has(s))),
								unlisted: shared.unlisted.filter((s) => want.has(s)),
								missing: shared.missing.filter((s) => want.has(s))
							};
						}
					}
				: {},
			{ maxFull: MAX_FULL_PER_BATCH }
		);
		out.fullFetches = r.fullFetches;
		for (const x of r.results) {
			if (x.outcome === 'appended') out.appended++;
			else if (x.outcome === 'deferred') out.deferred++;
			else if (x.outcome === 'failed') out.failed++;
		}
	}

	if (quoted) {
		const breadthSymbols = batch.filter((s) => ctx.breadth.has(s));
		if (breadthSymbols.length > 0) {
			try {
				const r = await deps.applyBreadthQuotes(breadthSymbols, quoted.quotes, ctx.tips);
				out.breadthApplied = r.appended + r.replaced;
			} catch {
				out.breadthError = true;
			}
		}
	}
	return out;
}

export async function readPassState(deps: Pick<IntradayDeps, 'getMeta'> = realDeps): Promise<PassState> {
	try {
		const raw = await deps.getMeta(STATE_KEY);
		return raw ? { ...emptyState(), ...(JSON.parse(raw) as Partial<PassState>) } : emptyState();
	} catch {
		return emptyState();
	}
}

/** When prices were last brought up to date by a completed pass or nightly run (ms), or null. */
export async function getPricesUpdatedAt(): Promise<number | null> {
	return (await readPassState()).lastCompletedAt;
}

/** The nightly run finished: record it so the page's "Updated" time reflects it too. */
export async function markPricesUpdated(deps: Pick<IntradayDeps, 'getMeta' | 'setMeta' | 'now'> = realDeps) {
	const state = await readPassState(deps);
	await deps.setMeta(STATE_KEY, JSON.stringify({ ...state, lastCompletedAt: deps.now().getTime() }));
}

/** A manual "Refresh all sectors" batch is running: background passes step aside for a while. */
export async function noteManualRefresh(deps: Pick<IntradayDeps, 'setMeta' | 'now'> = realDeps) {
	await deps.setMeta(MANUAL_KEY, String(deps.now().getTime() + MANUAL_BUSY_MS));
}

/** The nightly run takes the same lease the slices use, waiting for a slice in progress (at most
 *  one lease length, then the expired lease is ours). Returns a release function. */
export async function holdPriceLease(
	deps: Pick<IntradayDeps, 'acquire' | 'release' | 'now'> = realDeps,
	waitMs = LEASE_MS + 5_000,
	leaseMs = 6 * 60_000
): Promise<() => Promise<void>> {
	const started = Date.now();
	for (;;) {
		const now = deps.now().getTime();
		if (await deps.acquire(LEASE_KEY, now, now + leaseMs)) break;
		if (Date.now() - started > waitMs) break; // the holder is wedged: carry on
		await new Promise((r) => setTimeout(r, 2_000));
	}
	return () => deps.release(LEASE_KEY).catch(() => {});
}

/** Runs one bounded slice of the background price pass. Never throws. */
export async function runIntradaySlice(
	overrides: Partial<IntradayDeps> = {},
	budgetMs = SLICE_BUDGET_MS
): Promise<SliceSummary> {
	const deps = { ...realDeps, ...overrides };
	const started = Date.now();
	const out: SliceSummary = {
		status: 'idle',
		batches: 0,
		symbols: 0,
		appended: 0,
		fullFetches: 0,
		deferred: 0,
		failed: 0,
		breadthApplied: 0,
		breadthErrors: 0,
		stepsRun: [],
		stepsLeft: [],
		ms: 0
	};
	const done = (patch: Partial<SliceSummary>): SliceSummary => ({ ...out, ...patch, ms: Date.now() - started });
	let held = false;
	try {
		const now = deps.now();
		const state = await readPassState(deps);
		const plan = decide(state, now);
		if (plan.action === 'idle') return done({});

		const manualUntil = Number(await deps.getMeta(MANUAL_KEY)) || 0;
		if (manualUntil > now.getTime() || !(await deps.acquire(LEASE_KEY, now.getTime(), now.getTime() + LEASE_MS))) {
			return done({ status: 'busy' });
		}
		held = true;

		const day = istClock(now).day;
		let cur = state.current;
		if (plan.action === 'start') {
			cur = { kind: plan.kind, day, startedAt: now.getTime(), cursor: null };
			if (plan.kind === 'live') state.lastLiveStartedAt = now.getTime();
			else state.lastSettleDay = day;
			// The Nifty 50 is the trading calendar and what sectors are measured against.
			await deps.refreshBenchmark().catch((e) => console.error('[intraday-prices] benchmark refresh failed:', e));
		}
		if (!cur) return done({});
		out.kind = cur.kind;

		let error: string | undefined;
		if (!cur.todo) {
			const { symbols, ctx } = await loadLiveContext(deps);
			const after = cur.cursor;
			let remaining = after ? symbols.filter((s) => s > after) : symbols;
			while (remaining.length > 0 && out.batches < MAX_BATCHES_PER_SLICE && Date.now() - started < budgetMs) {
				const batch = remaining.slice(0, BATCH_SIZE);
				try {
					const r = await refreshLiveBatch(batch, ctx, deps);
					out.fullFetches += r.fullFetches;
					out.appended += r.appended;
					out.deferred += r.deferred;
					out.failed += r.failed;
					out.breadthApplied += r.breadthApplied;
					if (r.breadthError) out.breadthErrors++;
				} catch (e) {
					// Skip past the batch rather than wedge on it; the next pass tries it again.
					error = e instanceof Error ? e.message : String(e);
				}
				out.batches++;
				out.symbols += batch.length;
				cur.cursor = batch[batch.length - 1];
				remaining = remaining.slice(batch.length);
			}
			if (remaining.length === 0) {
				// Prices are in: stamp them. The breadth steps follow here if time allows, else next slice.
				state.lastCompletedAt = deps.now().getTime();
				cur.todo = ['cards', 'market'];
			}
		}

		// A step starts only while the slice still has time; what is left stays in the pass state for
		// the next minute's slice. A failing step is dropped (the next pass or the nightly job
		// recomputes it) rather than retried forever.
		while (cur.todo?.length && Date.now() - started < budgetMs) {
			const step = cur.todo[0];
			try {
				if (step === 'cards') await deps.refreshBreadthCards();
				else await deps.recomputeBreadthMarket();
			} catch (e) {
				error = `breadth ${step}: ${e instanceof Error ? e.message : String(e)}`;
			}
			cur.todo.shift();
			out.stepsRun.push(step);
		}
		if (cur.todo) out.stepsLeft = [...cur.todo];

		const completed = cur.todo != null && cur.todo.length === 0;
		state.current = completed ? null : cur;
		await deps.setMeta(STATE_KEY, JSON.stringify(state));
		return done({ status: completed ? 'completed' : 'running', cursor: cur.cursor, error });
	} catch (e) {
		return done({ status: 'error', error: e instanceof Error ? e.message : String(e) });
	} finally {
		if (held) await deps.release(LEASE_KEY).catch(() => {});
	}
}

/** The in-process stand-in for the cron piggyback (a long-running server such as local dev; on
 *  Vercel the every-minute cron calls `runIntradaySlice` instead). Safe to call more than once. */
export function startIntradayPriceScheduler() {
	const g = globalThis as unknown as { __intradayPricesStarted?: boolean; __intradayPricesBusy?: boolean };
	if (g.__intradayPricesStarted) return;
	g.__intradayPricesStarted = true;
	setInterval(() => {
		if (g.__intradayPricesBusy) return;
		g.__intradayPricesBusy = true;
		runIntradaySlice()
			.then((r) => {
				if (r.status === 'running' || r.status === 'completed' || r.status === 'error') {
					console.log(`[intraday-prices] ${r.status}: ${r.batches} batches, ${r.appended} appended, ${r.fullFetches} full, ${r.ms} ms${r.error ? ` (${r.error})` : ''}`);
				}
			})
			.finally(() => (g.__intradayPricesBusy = false));
	}, 60_000);
}
