import { inArray } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { stageScanCache } from '$lib/server/db/valuationSchema';
import { fetchMarketDepth, QUOTE_MAX_TOKENS, type LiveSnapshot } from './angelone';
import { isMarketOpenIST } from './marketHours';
import { liveSnapshotsFor, type LiveOutcome } from './liveBatch';
import { getStageScanResult, LIVE_TTL_MS } from './stageScanEngine';
import type { StageScanResult } from '../stageScan';

export const SCAN_BATCH_SIZE = QUOTE_MAX_TOKENS;

export interface ScanBatchItem {
	symbol: string;
	/** null: no price history for the symbol. */
	result: StageScanResult | null;
	error?: string;
}

interface Deps {
	marketOpen: () => boolean;
	/** The symbols whose stored live overlay is older than its freshness target. */
	staleLive: (symbols: string[]) => Promise<string[]>;
	liveFor: (symbols: string[]) => Promise<Map<string, LiveOutcome>>;
	scan: (symbol: string, liveSnapshot: LiveSnapshot | null | undefined) => Promise<StageScanResult | null>;
}

const realDeps: Deps = {
	marketOpen: isMarketOpenIST,
	async staleLive(symbols) {
		const rows = await db
			.select({ symbol: stageScanCache.symbol, liveFetchedAt: stageScanCache.liveFetchedAt })
			.from(stageScanCache)
			.where(inArray(stageScanCache.symbol, symbols));
		const fresh = new Set(
			rows.filter((r) => r.liveFetchedAt && Date.now() - r.liveFetchedAt < LIVE_TTL_MS).map((r) => r.symbol)
		);
		return symbols.filter((s) => !fresh.has(s));
	},
	liveFor: (symbols) =>
		liveSnapshotsFor(symbols, async (s) => {
			const depth = await fetchMarketDepth(s);
			return depth ? { ltp: depth.ltp, tradeVolume: depth.tradeVolume } : null;
		}),
	scan: (symbol, liveSnapshot) => getStageScanResult(symbol, { liveSnapshot })
};

/** Scan results for up to 50 symbols. While the market is open the symbols whose live overlay has
 *  gone stale get ONE quote request between them (instead of one each); a symbol the batch could
 *  not price is scanned as before, with the cached overlay or its own call. Results keep the
 *  order given; one symbol's failure is its own entry. */
export async function getStageScanBatch(symbols: string[], overrides: Partial<Deps> = {}): Promise<ScanBatchItem[]> {
	const deps = { ...realDeps, ...overrides };
	const wanted = [...new Set(symbols.map((s) => s.toUpperCase()))];
	let live = new Map<string, LiveOutcome>();
	if (deps.marketOpen()) {
		try {
			live = await deps.liveFor(await deps.staleLive(wanted));
		} catch {
			// Best effort, like the single-symbol overlay: scan without a fresh quote.
		}
	}
	const out: ScanBatchItem[] = [];
	for (const symbol of wanted) {
		const outcome = live.get(symbol);
		// An Error or null from the batch leaves the cached overlay in place (undefined would
		// make the engine call Angel One for this one symbol again).
		const snapshot = outcome === undefined ? undefined : outcome instanceof Error ? null : outcome;
		try {
			out.push({ symbol, result: await deps.scan(symbol, snapshot) });
		} catch (e) {
			out.push({ symbol, result: null, error: e instanceof Error ? e.message : 'Unknown error' });
		}
	}
	return out;
}
