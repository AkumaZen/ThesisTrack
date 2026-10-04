import { eq, inArray, sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { companyGrowthSeriesCache } from '$lib/server/db/valuationSchema';
import { fetchDailyCandles, type Candle } from './angelone';

// About 700 calendar days (~480 sessions): a 200-day average is complete across a full year of
// chart (252 sessions) only with 200 more sessions behind it.
const SERIES_DAYS = 700;

export interface CachedSeries {
	candles: Candle[];
	/** When these prices were last fetched from Angel One (ms). */
	fetchedAt: number;
}

/** The stored prices for one symbol, as they are - never goes to Angel One and never judges
 *  them stale. Prices are refreshed only by the scheduled refresh (a few times a day) or when
 *  someone presses Refresh, so a page view can never trigger a slow, rate-limited fetch.
 *  Null when nothing is stored for the symbol. */
export async function readCachedSeries(symbol: string): Promise<CachedSeries | null> {
	const [row] = await db
		.select()
		.from(companyGrowthSeriesCache)
		.where(eq(companyGrowthSeriesCache.symbol, symbol.toUpperCase()));
	return row ? { candles: row.candles as Candle[], fetchedAt: row.fetchedAt } : null;
}

export interface CachedCloses {
	dates: string[];
	closes: number[];
	fetchedAt: number;
}

/** Just the dates and closing prices of every given symbol that has stored prices, in ONE query.
 *  The database picks those two fields out of each stored record, so a sector's worth of stocks
 *  travels as a few kilobytes each instead of the whole open/high/low/close/volume history (about
 *  56 KB a stock) - which is what made a sector card take seconds against a remote database. */
export async function readCachedCloses(symbols: string[]): Promise<Map<string, CachedCloses>> {
	const out = new Map<string, CachedCloses>();
	const wanted = [...new Set(symbols.map((s) => s.toUpperCase()))];
	if (wanted.length === 0) return out;
	const rows = await db
		.select({
			symbol: companyGrowthSeriesCache.symbol,
			fetchedAt: companyGrowthSeriesCache.fetchedAt,
			dates: sql<string[]>`jsonb_path_query_array(${companyGrowthSeriesCache.candles}, '$[*].date')`,
			closes: sql<number[]>`jsonb_path_query_array(${companyGrowthSeriesCache.candles}, '$[*].close')`
		})
		.from(companyGrowthSeriesCache)
		.where(inArray(companyGrowthSeriesCache.symbol, wanted));
	for (const r of rows) out.set(r.symbol, { dates: r.dates, closes: r.closes, fetchedAt: r.fetchedAt });
	return out;
}

/** Stored candles only (see readCachedSeries) - the shared source for the sector rotation maths,
 *  the strength filters and the breakout scanner. Null when nothing is stored. */
export async function getCompanySeries(symbol: string): Promise<Candle[] | null> {
	return (await readCachedSeries(symbol))?.candles ?? null;
}

/** Fetches fresh prices from Angel One and stores them. Null when Angel One has no listing for
 *  the symbol. This is the only path that spends Angel One calls. */
export async function refreshCompanySeries(symbol: string): Promise<CachedSeries | null> {
	const key = symbol.toUpperCase();
	const candles = await fetchDailyCandles(key, SERIES_DAYS);
	if (!candles) return null;
	const fetchedAt = Date.now();
	await db
		.insert(companyGrowthSeriesCache)
		.values({ symbol: key, candles, fetchedAt })
		.onConflictDoUpdate({
			target: companyGrowthSeriesCache.symbol,
			set: { candles, fetchedAt }
		});
	return { candles, fetchedAt };
}
