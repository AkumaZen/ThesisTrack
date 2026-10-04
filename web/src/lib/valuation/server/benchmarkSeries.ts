import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { benchmarkSeriesCache } from '$lib/server/db/valuationSchema';
import { fetchIndexCandles, type Candle } from './angelone';
import { BENCHMARK_INDEX } from './sectorIndices';

const CANDLE_DAYS = 400;
const ID = 'nifty50';

/** Fetches the Nifty 50 from Angel One and stores it (scheduled refresh, or someone pressing
 *  Refresh). */
export async function refreshBenchmarkCandles(): Promise<Candle[]> {
	const candles = await fetchIndexCandles(BENCHMARK_INDEX.token, CANDLE_DAYS);
	await db
		.insert(benchmarkSeriesCache)
		.values({ id: ID, candles, fetchedAt: Date.now() })
		.onConflictDoUpdate({
			target: benchmarkSeriesCache.id,
			set: { candles, fetchedAt: Date.now() }
		});
	return candles;
}

/** The stored Nifty 50 candles - every sector's relative strength is measured against this one
 *  series. Stored once and used as it is, however old; only the very first use, when nothing is
 *  stored yet, fetches it. */
export async function getBenchmarkCandles(): Promise<Candle[]> {
	const [row] = await db.select().from(benchmarkSeriesCache).where(eq(benchmarkSeriesCache.id, ID));
	if (row) return row.candles as Candle[];
	return refreshBenchmarkCandles();
}
