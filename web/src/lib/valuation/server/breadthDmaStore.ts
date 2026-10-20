import { asc, count, sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { breadthCloses, marketBreadthDma } from '$lib/server/db/valuationSchema';
import {
	addSymbolDma,
	candlesToSeries,
	CHART_FROM,
	dayToIso,
	HISTORY_FROM,
	isoToDay,
	planBackfill,
	planDailyAppend,
	publishableRows,
	type ClosesStatus,
	type DmaRow,
	type QuotePoint,
	type StoredTip,
	type UniverseScrip
} from '../breadthDma';
import { fetchDayQuotes, fetchScripCandles, type Candle } from './angelone';
import { listBreadthUniverse } from './mcapUniverseStore';

/** Symbols fetched at once. The candles limiter (2 a second) is the real pace; a few in flight hide latency. */
const CONCURRENCY = 3;
/** Rows read per query when recomputing: 100 symbols of closes are a couple of MB. */
const READ_CHUNK = 100;
/** Rows written per statement. */
const WRITE_CHUNK = 25;
/** This many failures in a row means something systemic (rate limit, outage): stop and report. */
const MAX_CONSECUTIVE_FAILURES = 25;
/** One quote request's worth of symbols (Angel One accepts 50 tokens per call). */
const QUOTE_BATCH = 50;

export interface BackfillOptions {
	/** Stop starting new symbols after this many ms (the caller's function limit minus headroom). */
	budgetMs: number;
	/** Also refetch symbols whose last attempt failed. */
	retryFailed?: boolean;
}

export interface BackfillResult {
	universe: number;
	/** Symbols still to fetch when the run ended (0 = finished). */
	remaining: number;
	processed: number;
	done: number;
	empty: number;
	failed: number;
	finished: boolean;
	aborted: string | null;
	ms: number;
	/** Set when the run finished and the aggregate was recomputed. */
	aggregate: { rows: number; latest: string | null } | null;
}

export interface SeriesRow {
	symbol: string;
	status: ClosesStatus;
	error: string | null;
	days: number[];
	closes: number[];
}

interface BackfillDeps {
	listUniverse: () => Promise<UniverseScrip[]>;
	readStatuses: () => Promise<Map<string, ClosesStatus>>;
	fetchCandles: (scrip: UniverseScrip, from: Date, to: Date) => Promise<Candle[]>;
	saveRows: (rows: SeriesRow[]) => Promise<void>;
	recompute: () => Promise<{ rows: number; latest: string | null }>;
	now: () => number;
}

const AUTH_ERROR = /^ANGEL_(AUTH_FAILED|CREDENTIALS_MISSING|TOTP_INVALID)/;

const realBackfillDeps: BackfillDeps = {
	listUniverse: listBreadthUniverse,
	async readStatuses() {
		const rows = await db.select({ symbol: breadthCloses.symbol, status: breadthCloses.status }).from(breadthCloses);
		return new Map(rows.map((r) => [r.symbol, r.status as ClosesStatus]));
	},
	fetchCandles: (scrip, from, to) => fetchScripCandles(scrip.exch, scrip.token, from, to),
	async saveRows(rows) {
		for (let i = 0; i < rows.length; i += WRITE_CHUNK) {
			const part = rows.slice(i, i + WRITE_CHUNK).map((r) => ({
				symbol: r.symbol,
				status: r.status,
				error: r.error,
				days: r.days,
				closes: r.closes,
				lastDay: r.days.length ? r.days[r.days.length - 1] : null,
				updatedAt: new Date()
			}));
			await db
				.insert(breadthCloses)
				.values(part)
				.onConflictDoUpdate({
					target: breadthCloses.symbol,
					set: {
						status: sql`excluded.status`,
						error: sql`excluded.error`,
						days: sql`excluded.days`,
						closes: sql`excluded.closes`,
						lastDay: sql`excluded.last_day`,
						updatedAt: sql`excluded.updated_at`
					}
				});
		}
	},
	recompute: () => recomputeBreadthDma(),
	now: () => Date.now()
};

/** One resumable slice of the history backfill: fetches the daily closes (from HISTORY_FROM) of
 *  every universe symbol not yet stored, until the time budget runs out, saving as it goes. Call it
 *  again until `finished`. Progress lives in the database (a row per symbol with its status), so any
 *  invocation picks up exactly where the last stopped. When the last symbol is stored the daily
 *  aggregate is recomputed. A failed symbol is recorded and skipped, never fatal; only a login
 *  problem or a long run of failures stops the slice early (`aborted`). */
export async function runBreadthBackfill(
	options: BackfillOptions,
	overrides: Partial<BackfillDeps> = {}
): Promise<BackfillResult> {
	const deps = { ...realBackfillDeps, ...overrides };
	const started = deps.now();
	const universe = await deps.listUniverse();
	const pending = planBackfill(universe, await deps.readStatuses(), Boolean(options.retryFailed));
	const from = new Date(`${HISTORY_FROM}T00:00:00Z`);
	const to = new Date(deps.now());

	let next = 0;
	let consecutiveFailures = 0;
	let aborted: string | null = null;
	const counts = { done: 0, empty: 0, failed: 0 };
	let buffer: SeriesRow[] = [];
	let flushing: Promise<void> = Promise.resolve();
	const flush = () => {
		const rows = buffer;
		buffer = [];
		if (rows.length) flushing = flushing.then(() => deps.saveRows(rows));
		return flushing;
	};

	async function worker() {
		while (!aborted && next < pending.length && deps.now() - started < options.budgetMs) {
			const scrip = pending[next++];
			try {
				const { days, closes } = candlesToSeries(await deps.fetchCandles(scrip, from, to));
				const status: ClosesStatus = days.length ? 'done' : 'empty';
				counts[status]++;
				consecutiveFailures = 0;
				buffer.push({ symbol: scrip.symbol, status, error: null, days, closes });
			} catch (e) {
				const message = e instanceof Error ? e.message : String(e);
				if (AUTH_ERROR.test(message)) {
					aborted = message.slice(0, 120);
					next--;
					return;
				}
				counts.failed++;
				buffer.push({ symbol: scrip.symbol, status: 'failed', error: message.slice(0, 300), days: [], closes: [] });
				if (++consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) aborted = `${MAX_CONSECUTIVE_FAILURES} failures in a row, last: ${message.slice(0, 120)}`;
			}
			if (buffer.length >= WRITE_CHUNK) await flush();
		}
	}
	await Promise.all(Array.from({ length: CONCURRENCY }, worker));
	await flush();

	const processed = counts.done + counts.empty + counts.failed;
	// A symbol that failed this run is recorded as failed; it is only pending again on a retry run.
	const remaining = Math.max(0, pending.length - processed);
	const finished = remaining === 0 && !aborted;
	const aggregate = finished ? await deps.recompute() : null;
	return { universe: universe.length, remaining, processed, ...counts, finished, aborted, ms: deps.now() - started, aggregate };
}

/** Marks every stored symbol stale so the next backfill refetches all of them (after missed sessions). */
export async function markAllStale(): Promise<void> {
	await db.update(breadthCloses).set({ status: 'stale' });
}

/** Only symbols of the current universe count, even when breadth_closes still holds older ones (the
 *  previous Angel NSE universe, or companies that fell off the list). */
const inUniverse = (symbols: string[]) => sql`${breadthCloses.symbol} = ANY(${pgArray(symbols, 'text')})`;

/** Per-day readings (CHART_FROM on) of the stored closes of exactly these symbols, before the
 *  thin-day cut. Anything else in breadth_closes is ignored. */
export async function readDmaRows(symbols: string[]): Promise<Map<number, DmaRow>> {
	const rows = new Map<number, DmaRow>();
	const since = isoToDay(CHART_FROM);
	for (let offset = 0; ; offset += READ_CHUNK) {
		const part = await db
			.select({ days: breadthCloses.days, closes: breadthCloses.closes })
			.from(breadthCloses)
			.where(sql`${breadthCloses.status} = 'done' and ${inUniverse(symbols)}`)
			.orderBy(asc(breadthCloses.symbol))
			.limit(READ_CHUNK)
			.offset(offset);
		for (const s of part) addSymbolDma(rows, s.days, s.closes, since);
		if (part.length < READ_CHUNK) break;
	}
	return rows;
}

/** Recomputes the whole stored aggregate (CHART_FROM on) from the stored closes of the current universe.
 *  Reads only stored data: no Angel One call. */
export async function recomputeBreadthDma(
	universe: () => Promise<UniverseScrip[]> = listBreadthUniverse
): Promise<{ rows: number; latest: string | null }> {
	const rows = await readDmaRows((await universe()).map((u) => u.symbol));
	const out = publishableRows(rows);
	for (let i = 0; i < out.length; i += 100) {
		const values = out.slice(i, i + 100).map((r) => ({
			asOf: dayToIso(r.day),
			eligible50: r.eligible50,
			below50: r.below50,
			eligible200: r.eligible200,
			below200: r.below200,
			computedAt: new Date()
		}));
		await db
			.insert(marketBreadthDma)
			.values(values)
			.onConflictDoUpdate({
				target: marketBreadthDma.asOf,
				set: {
					eligible50: sql`excluded.eligible50`,
					below50: sql`excluded.below50`,
					eligible200: sql`excluded.eligible200`,
					below200: sql`excluded.below200`,
					computedAt: sql`excluded.computed_at`
				}
			});
	}
	return { rows: out.length, latest: out.length ? dayToIso(out[out.length - 1].day) : null };
}

export interface DailyAppendResult {
	symbols: number;
	appended: number;
	replaced: number;
	staleMarked: number;
	noQuote: number;
	weekend: number;
	failedBatches: number;
	aggregate: { rows: number; latest: string | null } | null;
}

interface AppendDeps {
	readTips: () => Promise<StoredTip[]>;
	fetchQuotes: (symbols: string[]) => Promise<{ quotes: Map<string, { date: string; ltp: number }> }>;
	apply: (plan: { append: DailyChange[]; replace: DailyChange[]; stale: string[] }) => Promise<void>;
	recompute: () => Promise<{ rows: number; latest: string | null }>;
}

/** A Postgres array literal from values (drizzle spreads a JS array into separate parameters). */
const pgArray = (values: (string | number)[], type: string) =>
	sql`ARRAY[${sql.join(values.map((v) => sql`${v}`), sql`, `)}]::${sql.raw(type)}[]`;

type DailyChange = { symbol: string; day: number; close: number };

/** Writes a daily plan: new sessions appended to the arrays, same-day closes settled, symbols that
 *  missed a session marked stale. Each statement is guarded by the stored last day, so applying a
 *  plan twice is harmless. */
export async function applyDailyPlan(plan: { append: DailyChange[]; replace: DailyChange[]; stale: string[] }): Promise<void> {
	const values = (part: DailyChange[]) => sql`(SELECT unnest(${pgArray(part.map((p) => p.symbol), 'text')}) AS s,
		unnest(${pgArray(part.map((p) => p.day), 'int')}) AS d,
		unnest(${pgArray(part.map((p) => p.close), 'float8')}) AS c) v`;
	for (let i = 0; i < plan.append.length; i += 500) {
		await db.execute(sql`
			UPDATE valuation.breadth_closes b
			SET days = b.days || v.d, closes = b.closes || v.c, last_day = v.d, updated_at = now()
			FROM ${values(plan.append.slice(i, i + 500))}
			WHERE b.symbol = v.s AND b.last_day < v.d`);
	}
	for (let i = 0; i < plan.replace.length; i += 500) {
		await db.execute(sql`
			UPDATE valuation.breadth_closes b
			SET closes[array_length(b.closes, 1)] = v.c, updated_at = now()
			FROM ${values(plan.replace.slice(i, i + 500))}
			WHERE b.symbol = v.s AND b.last_day = v.d`);
	}
	for (let i = 0; i < plan.stale.length; i += 500) {
		await db.execute(
			sql`UPDATE valuation.breadth_closes SET status = 'stale' WHERE symbol = ANY(${pgArray(plan.stale.slice(i, i + 500), 'text')})`
		);
	}
}

const realAppendDeps: AppendDeps = {
	async readTips() {
		const rows = await db
			.select({ symbol: breadthCloses.symbol, lastDay: breadthCloses.lastDay })
			.from(breadthCloses)
			.where(sql`${breadthCloses.status} = 'done' and ${inUniverse((await listBreadthUniverse()).map((u) => u.symbol))}`);
		return rows.filter((r) => r.lastDay != null).map((r) => ({ symbol: r.symbol, lastDay: r.lastDay as number }));
	},
	fetchQuotes: fetchDayQuotes,
	apply: applyDailyPlan,
	recompute: () => recomputeBreadthDma()
};

/** The daily step: one batched quote request per 50 stored symbols, then the newest close appended
 *  (or the last one settled) for each, and the aggregate recomputed. Weekend-dated quotes are
 *  skipped; delisted or suspended symbols have no fresh quote and are left alone; a failed quote
 *  batch costs only its own symbols. Symbols that missed a session are marked stale for the backfill. */
export async function appendDailyBreadth(overrides: Partial<AppendDeps> = {}): Promise<DailyAppendResult> {
	const deps = { ...realAppendDeps, ...overrides };
	const tips = await deps.readTips();
	const quotes = new Map<string, QuotePoint>();
	let failedBatches = 0;
	for (let i = 0; i < tips.length; i += QUOTE_BATCH) {
		const symbols = tips.slice(i, i + QUOTE_BATCH).map((t) => t.symbol);
		try {
			const got = await deps.fetchQuotes(symbols);
			for (const [symbol, q] of got.quotes) quotes.set(symbol, { day: isoToDay(q.date), iso: q.date, price: q.ltp });
		} catch {
			failedBatches++;
		}
	}
	const plan = planDailyAppend(tips, quotes);
	await deps.apply(plan);
	const changed = plan.append.length + plan.replace.length > 0;
	return {
		symbols: tips.length,
		appended: plan.append.length,
		replaced: plan.replace.length,
		staleMarked: plan.stale.length,
		noQuote: plan.skipped.noQuote,
		weekend: plan.skipped.weekend,
		failedBatches,
		aggregate: changed ? await deps.recompute() : null
	};
}

export interface BreadthDmaPoint {
	asOf: string;
	eligible50: number;
	below50: number;
	eligible200: number;
	below200: number;
}

export interface BackfillStatus {
	done: number;
	empty: number;
	failed: number;
	stale: number;
	computedAt: string | null;
}

/** The stored aggregate, oldest first, and the backfill's progress. Page views read only this. */
export async function readDmaBreadth(): Promise<{ points: BreadthDmaPoint[]; status: BackfillStatus }> {
	const symbols = (await listBreadthUniverse()).map((u) => u.symbol);
	const [rows, statusRows, [latest]] = await Promise.all([
		db.select().from(marketBreadthDma).orderBy(asc(marketBreadthDma.asOf)),
		db
			.select({ status: breadthCloses.status, n: count() })
			.from(breadthCloses)
			.where(inUniverse(symbols))
			.groupBy(breadthCloses.status),
		db
			.select({ at: sql<string | null>`max(${marketBreadthDma.computedAt})` })
			.from(marketBreadthDma)
	]);
	const n = (s: string) => statusRows.find((r) => r.status === s)?.n ?? 0;
	return {
		points: rows.map(({ asOf, eligible50, below50, eligible200, below200 }) => ({ asOf, eligible50, below50, eligible200, below200 })),
		status: {
			done: n('done'),
			empty: n('empty'),
			failed: n('failed'),
			stale: n('stale'),
			computedAt: latest?.at ? new Date(latest.at).toISOString() : null
		}
	};
}
