import { listAllSymbols } from './sectorStore';
import { refreshCompanySeries } from './companyGrowthSeries';
import { refreshBenchmarkCandles } from './benchmarkSeries';
import { runStructuralChecks } from './alertChecks';
import { dueRefreshSlot } from './refreshSlots';
import { db } from '$lib/server/db';
import { companyGrowthSeriesCache } from '$lib/server/db/valuationSchema';

// Prices are refreshed on four fixed moments each weekday (see refreshSlots.ts) and when someone
// presses Refresh - never because a page was opened. Every symbol is stored as soon as it is
// fetched, and the stalest go first, so a run cut short by the time limit leaves the caches
// fresher and the next run carries on from there.

// A symbol fetched this recently is left alone (two runs close together do not repeat the work).
const RECENT_MS = 30 * 60 * 1000;

export async function warmAllSectors() {
	try {
		await refreshBenchmarkCandles();
	} catch (e) {
		console.error('[sector-rotation-scheduler] benchmark refresh failed:', e);
	}

	// Every basket's constituents, deduped - several baskets share a symbol. Read from the DB each
	// run so baskets edited in the Sector Manager are picked up. Sequential: every call queues
	// through the same Angel One rate limiter regardless.
	const symbols = await listAllSymbols();
	const stored = await db
		.select({ symbol: companyGrowthSeriesCache.symbol, fetchedAt: companyGrowthSeriesCache.fetchedAt })
		.from(companyGrowthSeriesCache);
	const fetchedAt = new Map(stored.map((r) => [r.symbol, r.fetchedAt]));
	const at = (symbol: string) => fetchedAt.get(symbol.toUpperCase()) ?? 0;
	const queue = symbols
		.filter((s) => Date.now() - at(s) > RECENT_MS)
		.sort((a, b) => at(a) - at(b));

	for (const symbol of queue) {
		try {
			await refreshCompanySeries(symbol);
		} catch (e) {
			console.error(`[sector-rotation-scheduler] ${symbol} refresh failed:`, e);
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
