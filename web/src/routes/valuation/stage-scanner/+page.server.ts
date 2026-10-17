import type { PageServerLoad } from './$types';
import { db } from '$lib/server/db';
import { stageScanCache } from '$lib/server/db/valuationSchema';
import { listAllBaskets, getSymbolNames } from '$lib/valuation/server/sectorStore';
import { getAnalysisSettings } from '$lib/valuation/server/analysisSettingsStore';
import { listActiveUniverse, symbolsWithSeries, type UniverseCompany } from '$lib/valuation/server/mcapUniverseStore';
import {
	combineLiveOverlay,
	scanParamsKey,
	resultParamsKey,
	type LiveQuote,
	type StageScanResult,
	type StructuralResult
} from '$lib/valuation/stageScan';

// Instant: the universe, names, basket labels and every result already in the scan cache.
// Results computed with different settings are left out so the page fetches them fresh.
// The universe is the sector baskets plus the market cap list (valuation.mcap_universe); a
// company on the list with no price source is shown apart and never scanned.
export const load: PageServerLoad = async () => {
	const [baskets, rows, settings, listed] = await Promise.all([
		listAllBaskets(),
		db.select().from(stageScanCache),
		getAnalysisSettings(),
		// The list is optional: before migration 0020 / the import the scanner shows the baskets only.
		listActiveUniverse().catch((): UniverseCompany[] => [])
	]);
	const basketsBySymbol: Record<string, string[]> = {};
	for (const b of baskets) {
		for (const s of b.symbols) (basketsBySymbol[s] ??= []).push(b.label);
	}
	const mcapBySymbol: Record<string, number> = {};
	const universeNames: Record<string, string> = {};
	let mcapAsOf: string | null = null;
	const noPriceSource: { name: string; marketCapCr: number }[] = [];
	for (const c of listed) {
		if (c.asOf && (!mcapAsOf || c.asOf > mcapAsOf)) mcapAsOf = c.asOf;
		if (c.symbol) {
			mcapBySymbol[c.symbol] = c.marketCapCr;
			universeNames[c.symbol] = c.name;
		} else if (c.noPriceSource) noPriceSource.push({ name: c.name, marketCapCr: c.marketCapCr });
	}
	noPriceSource.sort((a, b) => b.marketCapCr - a.marketCapCr);
	const symbols = [...new Set([...Object.keys(basketsBySymbol), ...Object.keys(mcapBySymbol)])].sort();
	const names = { ...universeNames, ...(await getSymbolNames(Object.keys(basketsBySymbol))) };

	// Scanning reads stored prices only, so a company with none stored has nothing to scan: the page
	// shows it as "no price history" without a request (Load missing history fills them in).
	const stored = await symbolsWithSeries(symbols);
	const noSeries = symbols.filter((s) => !stored.has(s));

	const key = scanParamsKey(settings.scan);
	const known = new Set(symbols);
	const cached: Record<string, StageScanResult> = {};
	for (const r of rows) {
		const structural = r.structural as StructuralResult;
		if (!known.has(r.symbol) || resultParamsKey(structural) !== key) continue;
		cached[r.symbol] = combineLiveOverlay(structural, (r.live as LiveQuote | null) ?? null);
	}
	return { symbols, names, basketsBySymbol, cached, mcapBySymbol, mcapAsOf, noPriceSource, noSeries };
};
