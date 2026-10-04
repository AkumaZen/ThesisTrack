import { eq } from 'drizzle-orm';
import { db } from './db';
import { companyGrowthSeriesCache } from './db/schema';
import { fetchDailyCandles, type Candle } from './angelone';

// 2-hour cache window — a cold fetch walks every ticker through Angel One's rate limiter
// (minutes, not seconds), so this is set long enough that a normal working session never pays
// that cost twice. A background job (see scheduler.ts) proactively refreshes on this same
// cadence, so in practice a visitor rarely hits a genuinely cold entry at all.
const TTL_MS = 2 * 60 * 60 * 1000;
// 400 calendar days of buffer for a 252-trading-day (1Y) window, the same buffer-over-window
// ratio sectorRotation's 6M window uses.
const SERIES_DAYS = 400;

/** Cached full OHLCV candles for one symbol — the shared source for both the sector rotation
 *  overview's equal-weighted basket math (needs date-aligned closes) and the constituent
 *  drill-down page's per-company chart/growth panel (needs a full year of closes). Returns
 *  null if Angel One has no listing for the symbol. */
export async function getCompanySeries(symbol: string): Promise<Candle[] | null> {
	const key = symbol.toUpperCase();
	const [row] = await db
		.select()
		.from(companyGrowthSeriesCache)
		.where(eq(companyGrowthSeriesCache.symbol, key));
	if (row && Date.now() - row.fetchedAt < TTL_MS) {
		return row.candles as Candle[];
	}

	const candles = await fetchDailyCandles(key, SERIES_DAYS);
	if (!candles) return null;

	await db
		.insert(companyGrowthSeriesCache)
		.values({ symbol: key, candles, fetchedAt: Date.now() })
		.onConflictDoUpdate({
			target: companyGrowthSeriesCache.symbol,
			set: { candles, fetchedAt: Date.now() }
		});

	return candles;
}
