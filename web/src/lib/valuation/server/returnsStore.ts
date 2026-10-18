import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { nifty500SeriesCache } from '$lib/server/db/valuationSchema';
import type { Candle } from './angelone';
import { getBenchmarkCandles } from './benchmarkSeries';
import { readCachedCloses } from './companyGrowthSeries';
import { RETURN_INDICES, readWeeklySeries } from './longRangeStore';
import { resolveCompanyNames } from './companyNames';
import type { ClosePoint, ReturnItem } from '../returns';

const toPoints = (candles: Pick<Candle, 'date' | 'close'>[]): ClosePoint[] =>
	candles.map((c) => ({ date: c.date.slice(0, 10), close: c.close }));

/** Stored daily candles of an index (never fetches: a page view must not call Angel One). */
async function storedIndexCandles(key: string): Promise<ClosePoint[] | null> {
	if (key === RETURN_INDICES[0].key) return toPoints(await getBenchmarkCandles());
	const [row] = await db.select().from(nifty500SeriesCache).where(eq(nifty500SeriesCache.id, 'nifty500'));
	return row ? toPoints(row.candles as Candle[]) : null;
}

/** The series the returns page compares, from stored data only: daily closes for up to a year, weekly
 *  closes (loaded by "Load 5-year highs") for 3Y. */
export async function readReturnItems(symbols: string[], indexKeys: string[]): Promise<ReturnItem[]> {
	const stockKeys = [...new Set(symbols.map((s) => s.toUpperCase()))];
	const indices = RETURN_INDICES.filter((i) => indexKeys.includes(i.key));
	const [closes, weekly, names, indexDaily] = await Promise.all([
		readCachedCloses(stockKeys),
		readWeeklySeries([...stockKeys, ...indices.map((i) => i.key)]),
		resolveCompanyNames(stockKeys),
		Promise.all(indices.map((i) => storedIndexCandles(i.key)))
	]);
	const items: ReturnItem[] = indices.map((idx, n) => ({
		key: idx.key,
		label: idx.label,
		kind: 'index',
		daily: indexDaily[n],
		weekly: weekly.get(idx.key) ?? null
	}));
	for (const s of stockKeys) {
		const c = closes.get(s);
		items.push({
			key: s,
			label: names[s] && names[s] !== s ? `${names[s]} (${s})` : s,
			kind: 'stock',
			daily: c ? c.dates.map((d, i) => ({ date: d.slice(0, 10), close: c.closes[i] })) : null,
			weekly: weekly.get(s) ?? null
		});
	}
	return items;
}
