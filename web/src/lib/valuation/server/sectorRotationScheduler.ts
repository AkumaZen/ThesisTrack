import { listAllSymbols } from './sectorStore';
import { listUniverseSymbols } from './mcapUniverseStore';
import { BATCH_SIZE, refreshBatch } from './batchRefresh';
import { chunk } from './refreshMerge';
import { refreshBenchmarkCandles } from './benchmarkSeries';
import { runStructuralChecks } from './alertChecks';
import { holdPriceLease, markPricesUpdated } from './intradayPrices';
import { dueRefreshSlot } from './refreshSlots';
import { db } from '$lib/server/db';
import { companyGrowthSeriesCache, savedValuations, watchlistMembers } from '$lib/server/db/valuationSchema';

// Prices are refreshed on four fixed moments each weekday (see refreshSlots.ts) and when someone
// presses Refresh - never because a page was opened. Every symbol is stored as soon as it is
// fetched, and the stalest go first, so a run cut short by the time limit leaves the caches
// fresher and the next run carries on from there.

// A symbol fetched this recently is left alone (two runs close together do not repeat the work).
const RECENT_MS = 30 * 60 * 1000;

/** Every company on the watchlist (saved valuations and named-list members). These are not in any
 *  sector basket, so without them a watchlist-only company never got stored prices and its Trend
 *  column stayed empty. */
async function listWatchlistSymbols(): Promise<string[]> {
	const saved = await db.select({ symbol: savedValuations.symbol }).from(savedValuations);
	const members = await db.select({ symbol: watchlistMembers.symbol }).from(watchlistMembers);
	return [...saved, ...members].map((r) => r.symbol);
}

/** The symbols to fetch this run, stalest first (never-fetched ones lead): the union of both
 *  universes, de-duplicated case-insensitively, minus anything fetched within `recentMs`. */
export function buildRefreshQueue(
	symbolLists: string[][],
	fetchedAt: Map<string, number>,
	now = Date.now(),
	recentMs = RECENT_MS
): string[] {
	const at = (symbol: string) => fetchedAt.get(symbol) ?? 0;
	const unique = [...new Set(symbolLists.flat().map((s) => s.toUpperCase()))];
	return unique.filter((s) => now - at(s) > recentMs).sort((a, b) => at(a) - at(b) || a.localeCompare(b));
}

/** A cold run could otherwise spend the whole time budget: every symbol with no stored series costs a
 *  full history fetch (about half a second at the candles rate limit), and the market cap list adds
 *  up to ~1,500 of them. */
export const MAX_COLD_PER_RUN = 40;
/** Stop starting batches once this many full history fetches have been made in one run (a batch
 *  can also turn up gaps, which cost a full fetch too). The stalest go first, so the rest wait. */
export const MAX_FULL_PER_RUN = 100;

/** Keeps every symbol that already has a stored series (and any in `exempt`, the baskets and
 *  watchlists, which were never capped), but at most `max` of the others without one. The
 *  ones kept start at `rotateBy` (positions in the cold list), so a symbol Angel One can never
 *  price cannot hold the same slots every run: the window moves on. The rest wait for a later run
 *  or the "Load missing history" button. */
export function capColdSymbols(
	queue: string[],
	hasSeries: Set<string>,
	max = MAX_COLD_PER_RUN,
	rotateBy = 0,
	exempt: Set<string> = new Set()
): { queue: string[]; deferred: number } {
	const cold = queue.filter((s) => !hasSeries.has(s) && !exempt.has(s));
	if (cold.length <= max) return { queue, deferred: 0 };
	const coldSet = new Set(cold);
	const start = ((rotateBy % cold.length) + cold.length) % cold.length;
	const keep = new Set([...cold.slice(start), ...cold.slice(0, start)].slice(0, max));
	return { queue: queue.filter((s) => !coldSet.has(s) || keep.has(s)), deferred: cold.length - max };
}

export async function warmAllSectors() {
	try {
		await refreshBenchmarkCandles();
	} catch (e) {
		console.error('[sector-rotation-scheduler] benchmark refresh failed:', e);
	}

	// Every basket's constituents plus every watchlist company, deduped - several baskets share a symbol. Read from the DB each
	// run so baskets edited in the Sector Manager are picked up. Sequential: every call queues
	// through the same Angel One rate limiter regardless.
	const basketSymbols = await listAllSymbols();
	// A failed read of the watchlist must not stop the sector refresh.
	const watchlistSymbols = await listWatchlistSymbols().catch((e) => {
		console.error('[sector-rotation-scheduler] watchlist symbols unavailable:', e);
		return [] as string[];
	});
	// The market cap list the breakout scanner covers. A missing table (migration 0020 not applied
	// yet) must not stop the rest.
	const universeSymbols = await listUniverseSymbols().catch((e) => {
		console.error('[sector-rotation-scheduler] market cap universe unavailable:', e);
		return [] as string[];
	});
	const stored = await db
		.select({ symbol: companyGrowthSeriesCache.symbol, fetchedAt: companyGrowthSeriesCache.fetchedAt })
		.from(companyGrowthSeriesCache);
	const fetchedAt = new Map(stored.map((r) => [r.symbol.toUpperCase(), r.fetchedAt]));
	const fullQueue = buildRefreshQueue([basketSymbols, watchlistSymbols, universeSymbols], fetchedAt);
	const hasSeries = new Set(stored.map((r) => r.symbol.toUpperCase()));
	const { queue, deferred } = capColdSymbols(
		fullQueue,
		hasSeries,
		MAX_COLD_PER_RUN,
		Math.floor(Date.now() / 86_400_000) * MAX_COLD_PER_RUN,
		new Set([...basketSymbols, ...watchlistSymbols].map((s) => s.toUpperCase()))
	);
	if (deferred > 0) console.log(`[sector-rotation-scheduler] ${deferred} symbols without stored prices wait for a later run`);

	// Fifty at a time: one quote request brings the symbols that are a session behind up to date;
	// the rest (new, or a longer gap) are fetched in full. A failed batch must not stop the others.
	let fullFetches = 0;
	for (const batch of chunk(queue, BATCH_SIZE)) {
		if (fullFetches >= MAX_FULL_PER_RUN) {
			console.log('[sector-rotation-scheduler] full fetch budget used up; the rest wait for the next run');
			break;
		}
		try {
			const summary = await refreshBatch(batch);
			fullFetches += summary.fullFetches;
			const { results } = summary;
			for (const r of results) {
				if (r.outcome === 'failed') console.error(`[sector-rotation-scheduler] ${r.symbol} refresh failed: ${r.reason}`);
			}
		} catch (e) {
			console.error(`[sector-rotation-scheduler] batch starting ${batch[0]} failed:`, e);
		}
	}

	// Caches are now fresh: this is the cheap moment to look for sector flips and new breakouts
	// (zero extra Angel One calls), so alerts land as soon as the data does.
	try {
		await runStructuralChecks();
	} catch (e) {
		console.error('[sector-rotation-scheduler] alert checks failed:', e);
	}
}

/** Starts the in-process stand-in for the Vercel crons (a long-running server, e.g. local dev):
 *  looks every few minutes whether one of the four daily refresh moments is due. Nothing runs
 *  when the server starts. Safe to call more than once (e.g. across a dev-server HMR reload). */
export function startSectorRotationScheduler() {
	const g = globalThis as unknown as {
		__sectorRotationSchedulerStarted?: boolean;
		__lastRefreshSlot?: string;
	};
	if (g.__sectorRotationSchedulerStarted) return;
	g.__sectorRotationSchedulerStarted = true;

	setInterval(
		() => {
			const slot = dueRefreshSlot();
			if (!slot || slot === g.__lastRefreshSlot) return;
			g.__lastRefreshSlot = slot;
			// Same lease as the intraday passes, so the two never overlap.
			holdPriceLease()
				.then(async (release) => {
					try {
						await warmAllSectors();
						await markPricesUpdated().catch(() => {});
					} finally {
						await release();
					}
				})
				.catch((e) => console.error('[sector-rotation-scheduler] refresh failed:', e));
		},
		5 * 60 * 1000
	);
}
