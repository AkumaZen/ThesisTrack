import { readCachedSeries } from './companyGrowthSeries';
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
 * Computes ONE sector's rotation row from the STORED prices - used by the per-sector API
 * endpoint when a card is opened. It never calls Angel One: prices are refreshed by the
 * scheduled refresh or by pressing Refresh, so this is a few database reads and cheap maths
 * (date-align, average, diff against Nifty). `asOf` is the oldest fetch among the stocks, and
 * `missing` counts the stocks that have nothing stored.
 */
export async function getSectorReturn(sector: CustomSector): Promise<SectorReturn> {
	const [niftyCandles, settings, stored] = await Promise.all([
		getBenchmarkCandles(),
		getAnalysisSettings(),
		Promise.all(sector.symbols.map((symbol) => readCachedSeries(symbol)))
	]);

	const have = stored.filter((s): s is NonNullable<typeof s> => s != null);
	const candles = buildEqualWeightedIndex(have.map((s) => s.candles));

	const [row] = computeSectorReturns(
		[{ key: sector.key, label: sector.label, candles }],
		niftyCandles,
		settings.rotation
	);

	return {
		...row,
		constituents: sector.symbols,
		series: candles.map((c) => ({ date: c.date, value: c.close })),
		asOf: have.length ? Math.min(...have.map((s) => s.fetchedAt)) : null,
		missing: sector.symbols.length - have.length
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

	const dated = subsectorRows.map((r) => r.asOf).filter((t): t is number => t != null);
	return {
		...row,
		constituents: major.subsectorKeys,
		series: candles.map((c) => ({ date: c.date, value: c.close })),
		asOf: dated.length ? Math.min(...dated) : null,
		missing: subsectorRows.reduce((sum, r) => sum + (r.missing ?? 0), 0)
	};
}
