import { listAllSymbols } from './sectorStore';
import { listUniverseSymbols } from './mcapUniverseStore';

/** The Stage 2 Breakout Scanner's universe of stocks: every unique ticker across the sector
 *  rotation baskets (each verified against Screener.in, either by hand originally or by the
 *  Sector Manager at add time) plus the active companies of the market cap list (Rs 500 Cr to
 *  Rs 20,000 Cr, valuation.mcap_universe) that Angel One can price. Companies with no price source
 *  have no symbol and are never part of it. Read from the database each time so edits are
 *  picked up without a restart. */
export async function getStageScanUniverse(): Promise<string[]> {
	const [baskets, listed] = await Promise.all([listAllSymbols(), listUniverseSymbols().catch(() => [] as string[])]);
	return [...new Set([...baskets, ...listed.map((s) => s.toUpperCase())])].sort();
}
