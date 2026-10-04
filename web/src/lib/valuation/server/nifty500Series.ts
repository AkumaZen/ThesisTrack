import { eq } from 'drizzle-orm';
import { db } from './db';
import { nifty500SeriesCache } from './db/schema';
import { fetchIndexCandles, type Candle } from './angelone';
import { NIFTY500_INDEX } from './sectorIndices';

const TTL_MS = 2 * 60 * 60 * 1000;
const CANDLE_DAYS = 400;
const ID = 'nifty500';

/** Cached Nifty 500 candles — the Stage 2 Breakout Scanner's Mansfield RS benchmark. Every
 *  scanned symbol is compared against this one series, so it's fetched and cached once rather
 *  than once per symbol. */
export async function getNifty500Candles(): Promise<Candle[]> {
	const [row] = await db.select().from(nifty500SeriesCache).where(eq(nifty500SeriesCache.id, ID));
	if (row && Date.now() - row.fetchedAt < TTL_MS) {
		return row.candles as Candle[];
	}

	const candles = await fetchIndexCandles(NIFTY500_INDEX.token, CANDLE_DAYS);
	await db
		.insert(nifty500SeriesCache)
		.values({ id: ID, candles, fetchedAt: Date.now() })
		.onConflictDoUpdate({
			target: nifty500SeriesCache.id,
			set: { candles, fetchedAt: Date.now() }
		});

	return candles;
}
