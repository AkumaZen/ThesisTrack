import { desc, inArray, sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { companyGrowthSeriesCache, marketBreadth } from '$lib/server/db/valuationSchema';
import { addSymbolBreadth, BREADTH_DAYS, lastSessionDates, newBreadthRows, type BreadthRow } from '../breadth';
import type { Candle } from '../stageScan';
import { getBenchmarkCandles } from './benchmarkSeries';
import { getStageScanUniverse } from './stageScanUniverse';

/** Symbols read per query: the four arrays of 100 stocks are a few MB, not the whole 56 KB-a-stock record. */
const CHUNK = 100;

const toRow = (r: typeof marketBreadth.$inferSelect): BreadthRow => ({
	asOf: r.asOf,
	total: r.total,
	advances: r.advances,
	declines: r.declines,
	unchanged: r.unchanged,
	withDma50: r.withDma50,
	aboveDma50: r.aboveDma50,
	withDma200: r.withDma200,
	aboveDma200: r.aboveDma200,
	highs52w: r.highs52w,
	lows52w: r.lows52w
});

/** The stored breadth rows, oldest first. Page views read this only. */
export async function readBreadth(days = BREADTH_DAYS): Promise<BreadthRow[]> {
	const rows = await db.select().from(marketBreadth).orderBy(desc(marketBreadth.asOf)).limit(days);
	return rows.map(toRow).reverse();
}

/** Recomputes breadth for the last BREADTH_DAYS sessions from the stored candles of the scanner
 *  universe (no Angel One call) and stores one row per session. Returns the rows written. */
export async function refreshBreadth(): Promise<{ rows: number; symbols: number; asOf: string | null }> {
	const [universe, benchmark] = await Promise.all([getStageScanUniverse(), getBenchmarkCandles()]);
	const dates = lastSessionDates(benchmark, BREADTH_DAYS);
	if (dates.length === 0) return { rows: 0, symbols: 0, asOf: null };
	const rows = newBreadthRows(dates);

	let symbols = 0;
	for (let i = 0; i < universe.length; i += CHUNK) {
		const chunk = universe.slice(i, i + CHUNK);
		const stored = await db
			.select({
				dates: sql<string[]>`jsonb_path_query_array(${companyGrowthSeriesCache.candles}, '$[*].date')`,
				highs: sql<number[]>`jsonb_path_query_array(${companyGrowthSeriesCache.candles}, '$[*].high')`,
				lows: sql<number[]>`jsonb_path_query_array(${companyGrowthSeriesCache.candles}, '$[*].low')`,
				closes: sql<number[]>`jsonb_path_query_array(${companyGrowthSeriesCache.candles}, '$[*].close')`
			})
			.from(companyGrowthSeriesCache)
			.where(inArray(companyGrowthSeriesCache.symbol, chunk));
		for (const s of stored) {
			const candles: Candle[] = s.dates.map((date, k) => ({
				date,
				open: s.closes[k],
				high: s.highs[k],
				low: s.lows[k],
				close: s.closes[k],
				volume: 0
			}));
			addSymbolBreadth(rows, candles);
			symbols++;
		}
	}

	const values = [...rows.values()].filter((r) => r.total > 0);
	for (const r of values) {
		const { asOf, ...rest } = r;
		await db
			.insert(marketBreadth)
			.values({ asOf, ...rest, computedAt: new Date() })
			.onConflictDoUpdate({ target: marketBreadth.asOf, set: { ...rest, computedAt: new Date() } });
	}
	return { rows: values.length, symbols, asOf: values.length ? values[values.length - 1].asOf : null };
}
