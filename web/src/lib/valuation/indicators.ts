/**
 * Technical indicators on daily candles. Pure functions: no database, no network.
 *
 * Every series function returns an array the same length as its input, with null where the
 * indicator has not warmed up yet. All smoothing is Wilder's (RMA), the convention of the
 * standard charting packages, so values agree with what a chart shows.
 */
import type { Candle } from './stageScan';

export const RSI_PERIOD = 14;
export const ADX_PERIOD = 14;
export const SUPERTREND_PERIOD = 10;
export const SUPERTREND_MULTIPLIER = 3;
/** Golden cross on weekly closes: the 10-week average crossing above the 30-week average. */
export const WEEKS_FAST = 10;
export const WEEKS_SLOW = 30;

/** Relative Strength Index with Wilder smoothing. The first value sits at index `period`. */
export function rsiSeries(closes: number[], period = RSI_PERIOD): (number | null)[] {
	const out: (number | null)[] = closes.map(() => null);
	if (closes.length <= period) return out;
	let gain = 0;
	let loss = 0;
	for (let i = 1; i <= period; i++) {
		const d = closes[i] - closes[i - 1];
		if (d >= 0) gain += d;
		else loss -= d;
	}
	let avgGain = gain / period;
	let avgLoss = loss / period;
	const rsi = () => (avgLoss === 0 ? (avgGain === 0 ? 50 : 100) : 100 - 100 / (1 + avgGain / avgLoss));
	out[period] = rsi();
	for (let i = period + 1; i < closes.length; i++) {
		const d = closes[i] - closes[i - 1];
		avgGain = (avgGain * (period - 1) + (d > 0 ? d : 0)) / period;
		avgLoss = (avgLoss * (period - 1) + (d < 0 ? -d : 0)) / period;
		out[i] = rsi();
	}
	return out;
}

/** True range of each candle (the first one has no previous close: its own range). */
function trueRanges(candles: Candle[]): number[] {
	return candles.map((c, i) => {
		if (i === 0) return c.high - c.low;
		const pc = candles[i - 1].close;
		return Math.max(c.high - c.low, Math.abs(c.high - pc), Math.abs(c.low - pc));
	});
}

export interface AdxPoint {
	adx: number;
	plusDI: number;
	minusDI: number;
}

/** Average Directional Index with its +DI / -DI lines (Wilder). The first ADX sits at index
 *  `2 * period - 1`: `period` candles to seed the smoothed ranges, `period` more DX values to seed ADX. */
export function adxSeries(candles: Candle[], period = ADX_PERIOD): (AdxPoint | null)[] {
	const n = candles.length;
	const out: (AdxPoint | null)[] = candles.map(() => null);
	if (n < 2 * period) return out;
	const tr = trueRanges(candles);
	const plusDM: number[] = [0];
	const minusDM: number[] = [0];
	for (let i = 1; i < n; i++) {
		const up = candles[i].high - candles[i - 1].high;
		const down = candles[i - 1].low - candles[i].low;
		plusDM.push(up > down && up > 0 ? up : 0);
		minusDM.push(down > up && down > 0 ? down : 0);
	}
	// Wilder sums over candles 1..period seed the smoothed values.
	let sTR = 0;
	let sPlus = 0;
	let sMinus = 0;
	for (let i = 1; i <= period; i++) {
		sTR += tr[i];
		sPlus += plusDM[i];
		sMinus += minusDM[i];
	}
	const dx: number[] = [];
	const di = (): { plus: number; minus: number; dx: number } => {
		const plus = sTR > 0 ? (100 * sPlus) / sTR : 0;
		const minus = sTR > 0 ? (100 * sMinus) / sTR : 0;
		const sum = plus + minus;
		return { plus, minus, dx: sum > 0 ? (100 * Math.abs(plus - minus)) / sum : 0 };
	};
	let cur = di();
	dx.push(cur.dx);
	let adx = 0;
	let last = { plus: cur.plus, minus: cur.minus };
	for (let i = period + 1; i < n; i++) {
		sTR = sTR - sTR / period + tr[i];
		sPlus = sPlus - sPlus / period + plusDM[i];
		sMinus = sMinus - sMinus / period + minusDM[i];
		cur = di();
		last = { plus: cur.plus, minus: cur.minus };
		if (dx.length < period) {
			dx.push(cur.dx);
			if (dx.length === period) {
				adx = dx.reduce((a, b) => a + b, 0) / period;
				out[i] = { adx, plusDI: last.plus, minusDI: last.minus };
			}
		} else {
			adx = (adx * (period - 1) + cur.dx) / period;
			out[i] = { adx, plusDI: last.plus, minusDI: last.minus };
		}
	}
	return out;
}

export interface SuperTrendPoint {
	/** The trailing stop line: below price when bullish, above when bearish. */
	value: number;
	/** 1 = bullish (price above the line), -1 = bearish. */
	dir: 1 | -1;
}

/** SuperTrend: Wilder ATR bands around the mid price, ratcheting with the trend. Starts at index
 *  `period` (the first ATR is the plain average of the first `period` true ranges, like a chart's). */
export function superTrendSeries(
	candles: Candle[],
	period = SUPERTREND_PERIOD,
	multiplier = SUPERTREND_MULTIPLIER
): (SuperTrendPoint | null)[] {
	const n = candles.length;
	const out: (SuperTrendPoint | null)[] = candles.map(() => null);
	if (n <= period) return out;
	const tr = trueRanges(candles);
	// ATR seeded at index period - 1 by the mean of tr[0..period-1], then Wilder smoothing.
	let atr = tr.slice(0, period).reduce((a, b) => a + b, 0) / period;
	let finalUpper = 0;
	let finalLower = 0;
	let dir: 1 | -1 = 1;
	for (let i = period - 1; i < n; i++) {
		if (i >= period) atr = (atr * (period - 1) + tr[i]) / period;
		const c = candles[i];
		const mid = (c.high + c.low) / 2;
		const basicUpper = mid + multiplier * atr;
		const basicLower = mid - multiplier * atr;
		if (i === period - 1) {
			finalUpper = basicUpper;
			finalLower = basicLower;
			dir = c.close >= mid ? 1 : -1;
			continue; // warm-up candle: seeds the bands, no output yet
		}
		const prevClose = candles[i - 1].close;
		finalUpper = basicUpper < finalUpper || prevClose > finalUpper ? basicUpper : finalUpper;
		finalLower = basicLower > finalLower || prevClose < finalLower ? basicLower : finalLower;
		if (dir === -1 && c.close > finalUpper) dir = 1;
		else if (dir === 1 && c.close < finalLower) dir = -1;
		out[i] = { value: dir === 1 ? finalLower : finalUpper, dir };
	}
	return out;
}

// ---- Weekly averages and the golden cross ----

/** ISO date (YYYY-MM-DD) of the Monday of the week a date falls in. */
function weekStart(date: string): string {
	const d = new Date(`${date.slice(0, 10)}T00:00:00Z`);
	const back = (d.getUTCDay() + 6) % 7; // Monday = 0
	d.setUTCDate(d.getUTCDate() - back);
	return d.toISOString().slice(0, 10);
}

/** One close per week: the last daily close of each ISO week, oldest first. */
export function weeklyCloses(candles: Pick<Candle, 'date' | 'close'>[]): { week: string; close: number }[] {
	const out: { week: string; close: number }[] = [];
	for (const c of candles) {
		const week = weekStart(c.date);
		const last = out[out.length - 1];
		if (last && last.week === week) last.close = c.close;
		else out.push({ week, close: c.close });
	}
	return out;
}

/** Simple moving average; null until `period` values exist. */
export function smaSeries(values: number[], period: number): (number | null)[] {
	const out: (number | null)[] = values.map(() => null);
	let sum = 0;
	for (let i = 0; i < values.length; i++) {
		sum += values[i];
		if (i >= period) sum -= values[i - period];
		if (i >= period - 1) out[i] = sum / period;
	}
	return out;
}

export interface GoldenCross {
	/** Latest weekly 10-week and 30-week averages. */
	fast: number;
	slow: number;
	/** Weeks since the fast average last crossed above the slow one; null when it has not within the data. */
	crossAgeWeeks: number | null;
}

/** 10-week vs 30-week average of weekly closes. `crossAgeWeeks` is how many weeks ago the fast one
 *  moved from at-or-below the slow one to above it (0 = this week); it is reported only while the
 *  fast average is still above the slow one. Null when under 31 weeks of closes exist. */
export function goldenCross(
	candles: Pick<Candle, 'date' | 'close'>[],
	fastWeeks = WEEKS_FAST,
	slowWeeks = WEEKS_SLOW
): GoldenCross | null {
	const weeks = weeklyCloses(candles).map((w) => w.close);
	if (weeks.length <= slowWeeks) return null;
	const fast = smaSeries(weeks, fastWeeks);
	const slow = smaSeries(weeks, slowWeeks);
	const last = weeks.length - 1;
	const f = fast[last] as number;
	const s = slow[last] as number;
	let crossAgeWeeks: number | null = null;
	if (f > s) {
		for (let i = last; i > slowWeeks - 1; i--) {
			const pf = fast[i - 1] as number;
			const ps = slow[i - 1] as number;
			if (pf <= ps) {
				crossAgeWeeks = last - i;
				break;
			}
		}
	}
	return { fast: f, slow: s, crossAgeWeeks };
}

// ---- What the scanner stores ----

export interface TechnicalMetrics {
	rsi14: number | null;
	adx14: number | null;
	plusDI: number | null;
	minusDI: number | null;
	/** SuperTrend(10,3): current direction and the sessions since it last flipped (null if it never did in the data). */
	superTrend: { dir: 1 | -1; flipAge: number | null; value: number } | null;
	goldenCross: GoldenCross | null;
}

/** The latest value of each indicator, from CLOSED daily candles in date order. */
export function computeTechnicalMetrics(candles: Candle[]): TechnicalMetrics {
	const closes = candles.map((c) => c.close);
	const rsi = rsiSeries(closes);
	const adx = adxSeries(candles);
	const st = superTrendSeries(candles);
	const lastAdx = adx[adx.length - 1];
	const lastSt = st[st.length - 1];
	let superTrend: TechnicalMetrics['superTrend'] = null;
	if (lastSt) {
		let flipAge: number | null = null;
		for (let i = st.length - 1; i > 0; i--) {
			const prev = st[i - 1];
			if (prev && prev.dir !== lastSt.dir) {
				flipAge = st.length - 1 - i;
				break;
			}
		}
		superTrend = { dir: lastSt.dir, flipAge, value: lastSt.value };
	}
	return {
		rsi14: rsi[rsi.length - 1] ?? null,
		adx14: lastAdx?.adx ?? null,
		plusDI: lastAdx?.plusDI ?? null,
		minusDI: lastAdx?.minusDI ?? null,
		superTrend,
		goldenCross: goldenCross(candles)
	};
}
