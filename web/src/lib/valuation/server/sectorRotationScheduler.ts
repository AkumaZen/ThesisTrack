import { listAllSymbols } from './sectorStore';
import { BATCH_SIZE, refreshBatch } from './batchRefresh';
import { chunk } from './refreshMerge';
import { refreshBenchmarkCandles } from './benchmarkSeries';
import { runStructuralChecks } from './alertChecks';
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
	const stored = await db
		.select({ symbol: companyGrowthSeriesCache.symbol, fetchedAt: companyGrowthSeriesCache.fetchedAt })
		.from(companyGrowthSeriesCache);
	const fetchedAt = new Map(stored.map((r) => [r.symbol.toUpperCase(), r.fetchedAt]));
	const queue = buildRefreshQueue([basketSymbols, watchlistSymbols], fetchedAt);

	// Fifty at a time: one quote request brings the symbols that are a session behind up to date;
	// the rest (new, or a longer gap) are fetched in full. A failed batch must not stop the others.
	for (const batch of chunk(queue, BATCH_SIZE)) {
		try {
			const { results } = await refreshBatch(batch);
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
			warmAllSectors().catch((e) => console.error('[sector-rotation-scheduler] refresh failed:', e));
		},
		5 * 60 * 1000
	);
}
