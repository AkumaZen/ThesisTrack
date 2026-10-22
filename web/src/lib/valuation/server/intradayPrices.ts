// Keeps stored prices fresh during the trading day without anyone pressing Refresh. The
// every-minute cron (/api/cron/announcements) calls `runIntradaySlice`; each call works through a
// bounded slice of one "pass" over every sector symbol (quote path of refreshBatch), and a cursor in
// app_meta carries the pass over to the next minute until it completes. A new pass starts 30 minutes
// after the previous one started, from 09:15 to 15:30 IST on weekdays, plus one settle pass after
// 16:00 IST so the day's last candle stops being provisional. The nightly job and manual Refresh
// remain; a lease in app_meta keeps the passes from overlapping them.
import { eq, sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { appMeta } from '$lib/server/db/valuationSchema';
import { BATCH_SIZE, refreshBatch } from './batchRefresh';
import { refreshBenchmarkCandles } from './benchmarkSeries';
import { istClock } from './refreshMerge';
import { listAllSymbols } from './sectorStore';

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

export interface PassState {
	/** The pass being worked through, if any. `cursor` is the last symbol done. */
	current: { kind: PassKind; day: string; startedAt: number; cursor: string | null } | null;
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
	if (cur && cur.day === day && cur.kind === kind) return { action: 'resume' };
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
	listSymbols: () => Promise<string[]>;
	refreshBenchmark: () => Promise<unknown>;
	refreshBatch: typeof refreshBatch;
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
	listSymbols: listAllSymbols,
	refreshBenchmark: refreshBenchmarkCandles,
	refreshBatch
};

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

		const symbols = (await deps.listSymbols()).map((s) => s.toUpperCase()).sort();
		const after = cur.cursor;
		let remaining = after ? symbols.filter((s) => s > after) : symbols;
		let error: string | undefined;
		while (remaining.length > 0 && out.batches < MAX_BATCHES_PER_SLICE && Date.now() - started < budgetMs) {
			const batch = remaining.slice(0, BATCH_SIZE);
			try {
				const r = await deps.refreshBatch(batch, {}, { maxFull: MAX_FULL_PER_BATCH });
				out.fullFetches += r.fullFetches;
				for (const x of r.results) {
					if (x.outcome === 'appended') out.appended++;
					else if (x.outcome === 'deferred') out.deferred++;
					else if (x.outcome === 'failed') out.failed++;
				}
			} catch (e) {
				// Skip past the batch rather than wedge on it; the next pass tries it again.
				error = e instanceof Error ? e.message : String(e);
			}
			out.batches++;
			out.symbols += batch.length;
			cur.cursor = batch[batch.length - 1];
			remaining = remaining.slice(batch.length);
		}

		const completed = remaining.length === 0;
		if (completed) {
			state.lastCompletedAt = deps.now().getTime();
			state.current = null;
		} else {
			state.current = cur;
		}
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
