import { getCompanySeries } from './companyGrowthSeries';
import { getBenchmarkCandles } from './benchmarkSeries';
import type { CustomSector, MajorSector } from './customSectors';
import { findAnyCustomSector } from './sectorStore';
import { getAnalysisSettings } from './analysisSettingsStore';
import {
	computeSectorReturns,
	buildEqualWeightedIndex,
	type Candle,
	type SectorReturn
} from '../sectorRotation';

/**
 * Computes ONE sector's rotation row on demand - used by the per-sector API endpoint so the
 * overview page can render its 56 cards one at a time instead of blocking on every basket at
 * once. The expensive part (each constituent's own price history) comes from the shared,
 * persistently-cached getCompanySeries/getBenchmarkCandles - so this is cheap pure math
 * (date-align, average, diff against Nifty) whenever those are already warm, and only pays a
 * real network cost for symbols genuinely not yet cached.
 */
export async function getSectorReturn(sector: CustomSector): Promise<SectorReturn> {
	const [niftyCandles, settings, perStock] = await Promise.all([
		getBenchmarkCandles(),
		getAnalysisSettings(),
		// Sequential, not Promise.all, for the constituents themselves - every call still queues
		// through the same Angel One rate limiter regardless, so parallelizing here wouldn't
		// fetch any faster, only make the queue harder to reason about.
		(async () => {
			const out: (Candle[] | null)[] = [];
			for (const symbol of sector.symbols) {
				out.push(await getCompanySeries(symbol));
			}
			return out;
		})()
	]);

	const candles = buildEqualWeightedIndex(perStock.filter((c): c is Candle[] => c != null));

	const [row] = computeSectorReturns(
		[{ key: sector.key, label: sector.label, candles }],
		niftyCandles,
		settings.rotation
	);

	return {
		...row,
		constituents: sector.symbols,
		series: candles.map((c) => ({ date: c.date, value: c.close }))
	};
}

/**
 * Computes ONE major sector's rotation row - the top layer of the Sector -> Subsector ->
 * Company hierarchy. Built the same way a subsector is built from its constituent stocks: pull
 * each of this major sector's subsector rows (each already cache-backed via getSectorReturn ->
 * getCompanySeries, so this pays no extra Angel One cost once warm), turn each subsector's own
 * normalized series back into pseudo-candles, and average them equal-weighted into one
 * composite-of-composites index via the same buildEqualWeightedIndex/computeSectorReturns used
 * one layer down. No new cache table - this is cheap pure math over already-cached results.
 */
export async function getMajorSectorReturn(major: MajorSector): Promise<SectorReturn> {
	const [niftyCandles, settings, subsectorRows] = await Promise.all([
		getBenchmarkCandles(),
		getAnalysisSettings(),
		// Sequential, not Promise.all - same reasoning as getSectorReturn's own constituent loop:
		// every underlying stock fetch still queues through the one shared rate limiter regardless.
		(async () => {
			const out: SectorReturn[] = [];
			for (const key of major.subsectorKeys) {
				const sector = await findAnyCustomSector(key);
				if (sector) out.push(await getSectorReturn(sector));
			}
			return out;
		})()
	]);

	const perSubsector = subsectorRows
		.filter((r) => r.series && r.series.length > 0)
		.map((r) =>
			r.series!.map((p): Candle => ({
				date: p.date,
				open: p.value,
				high: p.value,
				low: p.value,
				close: p.value,
				volume: 0
			}))
		);

	const candles = buildEqualWeightedIndex(perSubsector);

	const [row] = computeSectorReturns(
		[{ key: major.key, label: major.label, candles }],
		niftyCandles,
		settings.rotation
	);

	return {
		...row,
		constituents: major.subsectorKeys,
		series: candles.map((c) => ({ date: c.date, value: c.close }))
	};
}
