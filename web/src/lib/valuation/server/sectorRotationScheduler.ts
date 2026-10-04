import { listAllSymbols } from './sectorStore';
import { getCompanySeries } from './companyGrowthSeries';
import { getBenchmarkCandles } from './benchmarkSeries';
import { runStructuralChecks } from './alertChecks';

// Same cadence as the caches themselves (companyGrowthSeries.ts / benchmarkSeries.ts, 2h TTL) —
// proactively keeping them warm means a real visitor almost never lands on a genuinely cold
// entry and pays the multi-minute rate-limited fetch themselves; the cost happens quietly in
// the background on a fixed schedule instead.
const REFRESH_INTERVAL_MS = 2 * 60 * 60 * 1000;

export async function warmAllSectors() {
	try {
		await getBenchmarkCandles();
	} catch (e) {
		console.error('[sector-rotation-scheduler] benchmark refresh failed:', e);
	}

	// Every basket's constituents, deduped — several baskets share a symbol (e.g. DIVISLAB in
	// both Pharma APIs and CDMOs), so each one is only fetched once per cycle. Sequential, not
	// parallel: every call queues through the same Angel One rate limiter regardless.
	// Read from the DB each cycle so baskets edited in the Sector Manager are picked up.
	const symbols = await listAllSymbols();
	for (const symbol of symbols) {
		try {
			await getCompanySeries(symbol);
		} catch (e) {
			console.error(`[sector-rotation-scheduler] ${symbol} refresh failed:`, e);
		}
	}

	// Caches are now fresh: this is the cheap moment to look for sector flips and new breakouts
	// (zero extra Angel One calls on a warm cache), so alerts land as soon as the data does.
	try {
		await runStructuralChecks();
	} catch (e) {
		console.error('[sector-rotation-scheduler] alert checks failed:', e);
	}
}

/** Starts the recurring background cache warmer. Safe to call more than once (e.g. across a
 *  dev-server HMR reload of this module) — only the first call actually schedules anything. */
export function startSectorRotationScheduler() {
	const g = globalThis as unknown as { __sectorRotationSchedulerStarted?: boolean };
	if (g.__sectorRotationSchedulerStarted) return;
	g.__sectorRotationSchedulerStarted = true;

	warmAllSectors().catch((e) =>
		console.error('[sector-rotation-scheduler] initial warm failed:', e)
	);
	setInterval(() => {
		warmAllSectors().catch((e) => console.error('[sector-rotation-scheduler] refresh failed:', e));
	}, REFRESH_INTERVAL_MS);
}
