/**
 * Long-range facts the stored daily series (about two years) cannot give: the highest high of up
 * to five years, and the close about three years ago. Pure: fed candles by the loader.
 */
import type { Candle } from './stageScan';

/** Calendar days of daily candles the loader asks Angel One for (it allows 2,000 per request). */
export const LONG_RANGE_DAYS = 1850;
/** Companies per load request: each is one 5-year candle fetch at the candle rate limit (2 a second). */
export const LONG_RANGE_BATCH_SIZE = 20;
const YEARS_3_MS = 3 * 365.25 * 24 * 60 * 60 * 1000;
const YEARS_5_MS = 5 * 365.25 * 24 * 60 * 60 * 1000;
/** A close within this many days of the 3-year mark counts as "the close three years ago". */
const CLOSE_3Y_TOLERANCE_DAYS = 7;

export interface LongRange {
	/** Highest high in the last five years (or since listing, when younger). */
	high5y: number;
	/** First candle date covered, YYYY-MM-DD: a recent date means the stock listed within five years. */
	fromDate: string;
	/** Close on the last session on or before the 3-year mark, null when the history does not reach back that far. */
	close3y: number | null;
	close3yDate: string | null;
}

const day = (c: { date: string }) => c.date.slice(0, 10);
const ms = (date: string) => new Date(`${date}T00:00:00Z`).getTime();

/** Summary of candles in date order; null when there are none. `asOf` is the latest candle's date. */
export function summarizeLongRange(candles: Pick<Candle, 'date' | 'high' | 'close'>[]): LongRange | null {
	if (candles.length === 0) return null;
	const last = ms(day(candles[candles.length - 1]));
	const from5 = last - YEARS_5_MS;
	let high = -Infinity;
	for (const c of candles) if (ms(day(c)) >= from5 && c.high > high) high = c.high;
	if (!Number.isFinite(high) || high <= 0) return null;

	const mark = last - YEARS_3_MS;
	let close3y: number | null = null;
	let close3yDate: string | null = null;
	for (const c of candles) {
		if (ms(day(c)) > mark) break;
		close3y = c.close;
		close3yDate = day(c);
	}
	if (close3yDate && (mark - ms(close3yDate)) / 86_400_000 > CLOSE_3Y_TOLERANCE_DAYS) {
		close3y = null;
		close3yDate = null;
	}
	return { high5y: high, fromDate: day(candles[0]), close3y, close3yDate };
}

/** The 5-year high brought up to date with the newer stored candles (the long fetch can be days old). */
export function currentHigh5y(stored: number | null | undefined, recentHigh: number | null | undefined): number | null {
	const values = [stored, recentHigh].filter((v): v is number => v != null && Number.isFinite(v) && v > 0);
	return values.length > 0 ? Math.max(...values) : null;
}
