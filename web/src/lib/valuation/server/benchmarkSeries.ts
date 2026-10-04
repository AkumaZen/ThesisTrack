import { eq } from 'drizzle-orm';
import { db } from './db';
import { benchmarkSeriesCache } from './db/schema';
import { fetchIndexCandles, type Candle } from './angelone';
import { BENCHMARK_INDEX } from './sectorIndices';

const TTL_MS = 2 * 60 * 60 * 1000;
const CANDLE_DAYS = 400;
const ID = 'nifty50';

/** Cached Nifty 50 candles — every sector's relative strength is measured against this one
 *  series, so it's fetched and cached once rather than once per sector (56 baskets asking for
 *  it independently would otherwise mean 56x the Angel One calls for a series that doesn't
 *  change across sectors). */
export async function getBenchmarkCandles(): Promise<Candle[]> {
	const [row] = await db.select().from(benchmarkSeriesCache).where(eq(benchmarkSeriesCache.id, ID));
	if (row && Date.now() - row.fetchedAt < TTL_MS) {
		return row.candles as Candle[];
	}

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
