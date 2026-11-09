import { eq, inArray, sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { benchmarkSeriesCache, companyGrowthSeriesCache } from '$lib/server/db/valuationSchema';
import { fetchDailyCandles, fetchDayQuotes, QUOTE_MAX_TOKENS, type Candle, type DayQuote } from './angelone';
import { refreshCompanySeries } from './companyGrowthSeries';
import { candleDay, gapFillDays, mergeGapFill, mergeQuote, type SessionCalendar } from './refreshMerge';

/** Full history refetches in flight at once inside one batch. candlesLimiter still enforces the
 *  Angel One caps per process; this only hides the network latency between calls. */
export const FULL_REFRESH_CONCURRENCY = 3;

/** One request's worth: matches the quote endpoint's 50-token limit. */
export const BATCH_SIZE = QUOTE_MAX_TOKENS;

export type BatchOutcome = 'appended' | 'full' | 'unchanged' | 'unlisted' | 'failed' | 'deferred';

export interface BatchItem {
	symbol: string;
	outcome: BatchOutcome;
	/** Why a full history refetch was needed, or what failed. */
	reason?: string;
}

export interface BatchSummary {
	results: BatchItem[];
	/** Angel One calls this batch spent besides the full fetches, for the run log. */
	quoteCalls: number;
	/** History calls made (full refetches and short gap fills); each costs one candles request. */
	fullFetches: number;
}

interface Deps {
	readSeries: (symbols: string[]) => Promise<Map<string, Candle[]>>;
	fetchQuotes: (symbols: string[]) => Promise<{ quotes: Map<string, DayQuote>; unlisted: string[]; missing: string[] }>;
	writeSeries: (rows: { symbol: string; candles: Candle[] }[], fetchedAt: number) => Promise<void>;
	fullRefresh: (symbol: string) => Promise<unknown | null>;
	/** The last `days` calendar days of history, or null when Angel One has no listing. */
	fetchRecent: (symbol: string, days: number) => Promise<Candle[] | null>;
	/** Trading sessions from the stored Nifty 50, or null when unavailable. */
	readCalendar: () => Promise<SessionCalendar | null>;
	now: () => Date;
}

const realDeps: Deps = {
	async readSeries(symbols) {
		const rows = await db
			.select({ symbol: companyGrowthSeriesCache.symbol, candles: companyGrowthSeriesCache.candles })
			.from(companyGrowthSeriesCache)
			.where(inArray(companyGrowthSeriesCache.symbol, symbols));
		return new Map(rows.map((r) => [r.symbol, r.candles as Candle[]]));
	},
	fetchQuotes: fetchDayQuotes,
	async writeSeries(rows, fetchedAt) {
		if (rows.length === 0) return;
		await db
			.insert(companyGrowthSeriesCache)
			.values(rows.map((r) => ({ symbol: r.symbol, candles: r.candles, fetchedAt })))
			.onConflictDoUpdate({
				target: companyGrowthSeriesCache.symbol,
				set: { candles: sql`excluded.candles`, fetchedAt: sql`excluded.fetched_at` }
			});
	},
	fullRefresh: refreshCompanySeries,
	fetchRecent: fetchDailyCandles,
	async readCalendar() {
		try {
			const [row] = await db
				.select({ dates: sql<string[]>`jsonb_path_query_array(${benchmarkSeriesCache.candles}, '$[*].date')` })
				.from(benchmarkSeriesCache)
				.where(eq(benchmarkSeriesCache.id, 'nifty50'));
			if (!row?.dates?.length) return null;
			return row.dates.map((d) => d.slice(0, 10)).sort();
		} catch {
			return null;
		}
	},
	now: () => new Date()
};

/** Brings the stored prices of up to BATCH_SIZE symbols up to date. Symbols whose stored series
 *  ends the session before (or is current) are served from ONE quote request and a single
 *  database write; symbols a few sessions behind get only the missing days from one short history
 *  fetch; symbols with no series, a long gap or a suspicious jump get the full history refetch.
 *  Results come back in the order given (duplicates dropped). */
export async function refreshBatch(
	symbols: string[],
	overrides: Partial<Deps> = {},
	/** The background jobs cap the slow history fetches: beyond `maxFull` per call, or once the
	 *  clock passes `deadline` (epoch ms), the rest come back 'deferred' (untouched, nothing
	 *  stored) and wait for the next pass. */
	options: { maxFull?: number; deadline?: number } = {}
): Promise<BatchSummary> {
	const deps = { ...realDeps, ...overrides };
	const wanted = [...new Set(symbols.map((s) => s.toUpperCase()))];
	const outcomes = new Map<string, BatchItem>();
	const needFull = new Map<string, string>(); // symbol -> reason
	let quoteCalls = 0;

	const stored = await deps.readSeries(wanted);
	// One read per batch; a failure just means the weekday rule applies.
	const calendar = await deps.readCalendar().catch(() => null);
	const withSeries = wanted.filter((s) => (stored.get(s)?.length ?? 0) > 0);
	for (const s of wanted) if (!withSeries.includes(s)) needFull.set(s, 'no stored series');

	if (withSeries.length > 0) {
		let quoted: Awaited<ReturnType<Deps['fetchQuotes']>> | null = null;
		try {
			quoted = await deps.fetchQuotes(withSeries);
			quoteCalls = Math.ceil(withSeries.length / BATCH_SIZE);
		} catch {
			// The quote call failed outright: do what Refresh always did, one full fetch each.
			for (const s of withSeries) needFull.set(s, 'quote unavailable');
		}
		if (quoted) {
			const unlisted = new Set(quoted.unlisted);
			const writes: { symbol: string; candles: Candle[] }[] = [];
			for (const s of withSeries) {
				if (unlisted.has(s)) {
					outcomes.set(s, { symbol: s, outcome: 'unlisted' });
					continue;
				}
				const q = quoted.quotes.get(s);
				if (!q) {
					needFull.set(s, 'no quote');
					continue;
				}
				const merged = mergeQuote(stored.get(s)!, q, deps.now(), calendar);
				if (merged.kind === 'unchanged') outcomes.set(s, { symbol: s, outcome: 'unchanged' });
				else if (merged.kind === 'full') needFull.set(s, merged.reason);
				else {
					writes.push({ symbol: s, candles: merged.candles });
					outcomes.set(s, { symbol: s, outcome: 'appended' });
				}
			}
			try {
				await deps.writeSeries(writes, deps.now().getTime());
			} catch (e) {
				const reason = e instanceof Error ? e.message : 'write failed';
				for (const w of writes) outcomes.set(w.symbol, { symbol: w.symbol, outcome: 'failed', reason });
			}
		}
	}

	const queue = [...needFull];
	for (const [symbol] of queue.splice(options.maxFull ?? queue.length)) {
		outcomes.set(symbol, { symbol, outcome: 'deferred', reason: needFull.get(symbol) });
	}
	let fullFetches = 0;
	const full = async (symbol: string, why: string) => {
		fullFetches++;
		const fresh = await deps.fullRefresh(symbol);
		outcomes.set(symbol, fresh ? { symbol, outcome: 'full', reason: why } : { symbol, outcome: 'unlisted' });
	};
	// A series a few sessions behind (a missed run, a holiday week, a special session such as
	// Muhurat trading) needs only the missing days: a short fetch merged onto what is stored.
	const gapFill = async (symbol: string): Promise<boolean> => {
		const series = stored.get(symbol);
		const last = series?.at(-1);
		const days = last ? gapFillDays(candleDay(last), deps.now()) : null;
		if (!series || days === null) return false;
		fullFetches++;
		const fetched = await deps.fetchRecent(symbol, days);
		if (!fetched) {
			outcomes.set(symbol, { symbol, outcome: 'unlisted' });
			return true;
		}
		const merged = mergeGapFill(series, fetched, deps.now());
		if (merged.kind === 'full') {
			await full(symbol, merged.reason);
			return true;
		}
		await deps.writeSeries([{ symbol, candles: merged.candles }], deps.now().getTime());
		outcomes.set(symbol, { symbol, outcome: 'appended', reason: 'gap filled' });
		return true;
	};
	const worker = async () => {
		for (let next = queue.shift(); next; next = queue.shift()) {
			const [symbol, why] = next;
			if (options.deadline !== undefined && deps.now().getTime() >= options.deadline) {
				outcomes.set(symbol, { symbol, outcome: 'deferred', reason: why });
				continue;
			}
			try {
				if (why === 'gap' && (await gapFill(symbol))) continue;
				await full(symbol, why);
			} catch (e) {
				outcomes.set(symbol, { symbol, outcome: 'failed', reason: e instanceof Error ? e.message : 'Unknown error' });
			}
		}
	};
	await Promise.all(Array.from({ length: Math.min(FULL_REFRESH_CONCURRENCY, queue.length) }, worker));

	return { results: wanted.map((s) => outcomes.get(s)!), quoteCalls, fullFetches };
}
