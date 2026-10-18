/**
 * Market breadth over the scanner universe, computed from stored daily candles: how many stocks
 * advanced or declined, how many sit above their 50 and 200 day averages, and how many are at a
 * 52-week high or low. Pure: a loader feeds each symbol's candles in, one symbol at a time.
 */
import type { Candle } from './stageScan';

export const DMA_SHORT = 50;
export const DMA_LONG = 200;
/** A 52-week window is this many sessions. */
export const SESSIONS_52W = 252;
/** A stock needs at least this many sessions up to a day to be judged on its 52-week range. */
export const MIN_SESSIONS_52W = 200;
/** How many trading days of breadth history the page shows (and the refresh job recomputes). */
export const BREADTH_DAYS = 30;

export interface BreadthRow {
	asOf: string;
	total: number;
	advances: number;
	declines: number;
	unchanged: number;
	withDma50: number;
	aboveDma50: number;
	withDma200: number;
	aboveDma200: number;
	highs52w: number;
	lows52w: number;
}

export const emptyBreadthRow = (asOf: string): BreadthRow => ({
	asOf,
	total: 0,
	advances: 0,
	declines: 0,
	unchanged: 0,
	withDma50: 0,
	aboveDma50: 0,
	withDma200: 0,
	aboveDma200: 0,
	highs52w: 0,
	lows52w: 0
});

const day = (c: { date: string }) => c.date.slice(0, 10);

/** The last `n` session dates of a series, oldest first. */
export function lastSessionDates(candles: { date: string }[], n: number): string[] {
	return candles.slice(-n).map(day);
}

/** Adds one symbol's reading for each requested date into the per-date rows. A date the symbol has
 *  no candle on (not trading, or not listed yet) leaves that row untouched. */
export function addSymbolBreadth(rows: Map<string, BreadthRow>, candles: Candle[]): void {
	if (candles.length < 2) return;
	const index = new Map<string, number>();
	candles.forEach((c, i) => index.set(day(c), i));
	// Prefix sums of closes give any moving average in O(1).
	const prefix = new Array<number>(candles.length + 1).fill(0);
	candles.forEach((c, i) => (prefix[i + 1] = prefix[i] + c.close));
	const sma = (i: number, period: number) => (i + 1 >= period ? (prefix[i + 1] - prefix[i + 1 - period]) / period : null);

	for (const [date, row] of rows) {
		const i = index.get(date);
		if (i == null || i === 0) continue;
		const c = candles[i];
		row.total++;
		if (c.close > candles[i - 1].close) row.advances++;
		else if (c.close < candles[i - 1].close) row.declines++;
		else row.unchanged++;

		const s50 = sma(i, DMA_SHORT);
		if (s50 != null) {
			row.withDma50++;
			if (c.close > s50) row.aboveDma50++;
		}
		const s200 = sma(i, DMA_LONG);
		if (s200 != null) {
			row.withDma200++;
			if (c.close > s200) row.aboveDma200++;
		}
		if (i + 1 >= MIN_SESSIONS_52W) {
			let hi = -Infinity;
			let lo = Infinity;
			for (let k = Math.max(0, i + 1 - SESSIONS_52W); k <= i; k++) {
				if (candles[k].high > hi) hi = candles[k].high;
				if (candles[k].low < lo) lo = candles[k].low;
			}
			if (c.high >= hi) row.highs52w++;
			if (c.low <= lo) row.lows52w++;
		}
	}
}

/** Fresh rows for the given dates (oldest first), keyed by date. */
export function newBreadthRows(dates: string[]): Map<string, BreadthRow> {
	return new Map(dates.map((d) => [d, emptyBreadthRow(d)]));
}

/** Share of `part` in `whole` as a percent, null when nothing was measured. */
export const pct = (part: number, whole: number): number | null => (whole > 0 ? (part / whole) * 100 : null);

/** Advance/decline ratio (advances per decline); null when nothing declined. */
export const advanceDeclineRatio = (r: Pick<BreadthRow, 'advances' | 'declines'>): number | null =>
	r.declines > 0 ? r.advances / r.declines : null;

/** A plain-words reading of the latest row, from the share above the 200 day average and the advance share. */
export function breadthRead(r: BreadthRow): 'strong' | 'mixed' | 'weak' | 'no data' {
	const above = pct(r.aboveDma200, r.withDma200);
	if (above == null) return 'no data';
	if (above >= 60) return 'strong';
	if (above <= 40) return 'weak';
	return 'mixed';
}
