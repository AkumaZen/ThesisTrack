// "Load missing history" on the breakout scanner: the market cap list's companies that have no
// stored prices yet are fetched through the same batched endpoint as Refresh all sectors
// (POST /api/valuation/refresh-batch, driven by runSteps in refreshAll.ts).
import { batchSteps, type RefreshStep } from './refreshAll';

/** Companies per request. Every one of them is a full history fetch (the candles limiter allows
 *  2 a second, so about 0.5 s each plus Angel One's own latency): 25 take roughly 15 to 30 s, far
 *  inside the 120 s function limit, where 50 could take a minute or more and leave a failed
 *  request with nothing to show for it. */
export const HISTORY_BATCH_SIZE = 25;

/** The steps that load these companies' history, in order. */
export function historySteps(symbols: string[], size = HISTORY_BATCH_SIZE): RefreshStep[] {
	const unique = [...new Set(symbols.map((s) => s.toUpperCase()))];
	return batchSteps(
		unique.map((symbol) => ({ symbol, sector: 'Market cap list' })),
		size
	);
}

/** Those of `planned` that are no longer missing after the run, i.e. now have stored prices. */
export function newlyLoaded(planned: string[], stillMissing: string[]): string[] {
	const missing = new Set(stillMissing.map((s) => s.toUpperCase()));
	return planned.map((s) => s.toUpperCase()).filter((s) => !missing.has(s));
}
