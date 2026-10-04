import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { sparklineCache } from '$lib/server/db/valuationSchema';
import { fetchDailyCandles } from './angelone';

// Daily candles only change once per trading session, and the sparkline is a shape indicator,
// not a live price — a 30-minute cache avoids re-hitting Angel One every time a watchlist row
// loads, without ever showing meaningfully stale data. Persisted to the DB (like companyCache)
// rather than kept in-memory only, so a server restart doesn't drop the cache and force a full
// re-fetch of every watchlist symbol's sparkline on the next load.
const TTL_MS = 30 * 60 * 1000;

/** Cached wrapper around fetchDailyCandles's closes, for the watchlist/sector-rotation
 *  sparkline endpoints — returns null if Angel One has no listing for the symbol. */
export async function getSparklineCloses(symbol: string): Promise<number[] | null> {
	const key = symbol.toUpperCase();
	const [row] = await db.select().from(sparklineCache).where(eq(sparklineCache.symbol, key));
	if (row && Date.now() - row.fetchedAt < TTL_MS) {
		return row.closes;
	}

	const candles = await fetchDailyCandles(key, 90);
	if (!candles) return null;

	const closes = candles.map((c) => c.close);
	await db
		.insert(sparklineCache)
		.values({ symbol: key, closes, fetchedAt: Date.now() })
		.onConflictDoUpdate({
			target: sparklineCache.symbol,
			set: { closes, fetchedAt: Date.now() }
		});

	return closes;
}
