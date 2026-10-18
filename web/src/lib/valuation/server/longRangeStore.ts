import { inArray, isNotNull } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { longTermHighs } from '$lib/server/db/valuationSchema';
import { fetchDailyCandles, fetchIndexCandles, type Candle } from './angelone';
import { BENCHMARK_INDEX, NIFTY500_INDEX } from './sectorIndices';
import { getStageScanUniverse } from './stageScanUniverse';
import { LONG_RANGE_DAYS, summarizeLongRange } from '../longRange';
import { weeklySeries } from '../returns';

/** The indices the returns benchmark can compare against, stored here under an IDX: key. */
export const RETURN_INDICES = [
	{ key: `IDX:${BENCHMARK_INDEX.key.toUpperCase()}`, label: BENCHMARK_INDEX.label, token: BENCHMARK_INDEX.token },
	{ key: `IDX:${NIFTY500_INDEX.key.toUpperCase()}`, label: NIFTY500_INDEX.label, token: NIFTY500_INDEX.token }
];
const THREE_YEARS_AND_A_WEEK_MS = (3 * 365.25 + 7) * 24 * 60 * 60 * 1000;

/** The stored 5-year highs (and 3-year-ago closes) by symbol. */
export async function readLongRange(): Promise<Map<string, { high5y: number; fromDate: string; close3y: number | null }>> {
	const rows = await db
		.select({
			symbol: longTermHighs.symbol,
			high5y: longTermHighs.high5y,
			fromDate: longTermHighs.fromDate,
			close3y: longTermHighs.close3y
		})
		.from(longTermHighs);
	return new Map(rows.map((r) => [r.symbol, { high5y: r.high5y, fromDate: r.fromDate, close3y: r.close3y }]));
}

/** Scanner-universe tickers (and the two return indices) with no stored long-range row, or one from before the weekly series: what "Load 5-year highs" fetches. */
export async function symbolsMissingLongRange(): Promise<string[]> {
	const [universe, have] = await Promise.all([
		getStageScanUniverse(),
		db.select({ symbol: longTermHighs.symbol }).from(longTermHighs).where(isNotNull(longTermHighs.weekly3y))
	]);
	const done = new Set(have.map((r) => r.symbol));
	return [...RETURN_INDICES.map((i) => i.key), ...universe].filter((s) => !done.has(s));
}

/** Fetches up to five years of daily candles for each symbol and stores the summary. A symbol
 *  Angel One does not list, or with no candles, is reported as failed and stays missing. */
export async function refreshLongRange(symbols: string[]): Promise<{ ok: number; failed: { symbol: string; error: string }[] }> {
	let ok = 0;
	const failed: { symbol: string; error: string }[] = [];
	for (const symbol of symbols) {
		try {
			const index = RETURN_INDICES.find((i) => i.key === symbol);
			const candles: Candle[] | null = index
				? await fetchIndexCandles(index.token, LONG_RANGE_DAYS)
				: await fetchDailyCandles(symbol, LONG_RANGE_DAYS);
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
				weekly3y: weeklySeries(candles!, new Date(Date.now() - THREE_YEARS_AND_A_WEEK_MS).toISOString().slice(0, 10)),
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

/** The stored weekly 3-year closes of the given keys (stocks or IDX: index keys). */
export async function readWeeklySeries(keys: string[]): Promise<Map<string, { date: string; close: number }[]>> {
	if (keys.length === 0) return new Map();
	const rows = await db
		.select({ symbol: longTermHighs.symbol, weekly: longTermHighs.weekly3y })
		.from(longTermHighs)
		.where(inArray(longTermHighs.symbol, keys));
	return new Map(rows.filter((r) => r.weekly).map((r) => [r.symbol, r.weekly!]));
}
