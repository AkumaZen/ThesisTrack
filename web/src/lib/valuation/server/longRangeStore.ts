import { db } from '$lib/server/db';
import { longTermHighs } from '$lib/server/db/valuationSchema';
import { fetchDailyCandles } from './angelone';
import { getStageScanUniverse } from './stageScanUniverse';
import { LONG_RANGE_DAYS, summarizeLongRange } from '../longRange';

/** The stored 5-year highs (and 3-year-ago closes) by symbol. */
export async function readLongRange(): Promise<Map<string, { high5y: number; fromDate: string; close3y: number | null }>> {
	const rows = await db.select().from(longTermHighs);
	return new Map(rows.map((r) => [r.symbol, { high5y: r.high5y, fromDate: r.fromDate, close3y: r.close3y }]));
}

/** Scanner-universe tickers with no stored long-range row: what "Load 5-year highs" fetches. */
export async function symbolsMissingLongRange(): Promise<string[]> {
	const [universe, have] = await Promise.all([
		getStageScanUniverse(),
		db.select({ symbol: longTermHighs.symbol }).from(longTermHighs)
	]);
	const done = new Set(have.map((r) => r.symbol));
	return universe.filter((s) => !done.has(s));
}

/** Fetches up to five years of daily candles for each symbol and stores the summary. A symbol
 *  Angel One does not list, or with no candles, is reported as failed and stays missing. */
export async function refreshLongRange(symbols: string[]): Promise<{ ok: number; failed: { symbol: string; error: string }[] }> {
	let ok = 0;
	const failed: { symbol: string; error: string }[] = [];
	for (const symbol of symbols) {
		try {
			const candles = await fetchDailyCandles(symbol, LONG_RANGE_DAYS);
			const summary = candles ? summarizeLongRange(candles) : null;
			if (!summary) {
				failed.push({ symbol, error: candles ? 'no candles' : 'not listed on Angel One' });
				continue;
			}
			const values = {
				symbol,
				high5y: summary.high5y,
				fromDate: summary.fromDate,
				close3y: summary.close3y,
				close3yDate: summary.close3yDate,
				fetchedAt: Date.now()
			};
			await db.insert(longTermHighs).values(values).onConflictDoUpdate({ target: longTermHighs.symbol, set: values });
			ok++;
		} catch (e) {
			failed.push({ symbol, error: e instanceof Error ? e.message.slice(0, 120) : 'Unknown error' });
		}
	}
	return { ok, failed };
}
