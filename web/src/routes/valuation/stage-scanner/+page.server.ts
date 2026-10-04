import type { PageServerLoad } from './$types';
import { db } from '$lib/server/db';
import { stageScanCache } from '$lib/server/db/schema';
import { listAllBaskets, getSymbolNames } from '$lib/server/sectorStore';
import { getAnalysisSettings } from '$lib/server/analysisSettingsStore';
import {
	combineLiveOverlay,
	scanParamsKey,
	resultParamsKey,
	type LiveQuote,
	type StageScanResult,
	type StructuralResult
} from '$lib/stageScan';

// Instant: the universe, names, basket labels and every result already in the scan cache.
// Results computed with different settings are left out so the page fetches them fresh.
export const load: PageServerLoad = async () => {
	const [baskets, rows, settings] = await Promise.all([
		listAllBaskets(),
		db.select().from(stageScanCache),
		getAnalysisSettings()
	]);
	const basketsBySymbol: Record<string, string[]> = {};
	for (const b of baskets) {
		for (const s of b.symbols) (basketsBySymbol[s] ??= []).push(b.label);
	}
	const symbols = Object.keys(basketsBySymbol).sort();
	const names = await getSymbolNames(symbols);

	const key = scanParamsKey(settings.scan);
	const cached: Record<string, StageScanResult> = {};
	for (const r of rows) {
		const structural = r.structural as StructuralResult;
		if (!basketsBySymbol[r.symbol] || resultParamsKey(structural) !== key) continue;
		cached[r.symbol] = combineLiveOverlay(structural, (r.live as LiveQuote | null) ?? null);
	}
	return { symbols, names, basketsBySymbol, cached };
};
