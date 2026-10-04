// Price chart data: daily closes with 50- and 200-day simple moving averages. Pure, no I/O.
// The averages are computed over the FULL history fetched, then only the last `bars` sessions are
// returned, so the 200-day line is complete across the whole visible range (it needs 200 earlier
// sessions behind the first plotted day).

export interface PricePoint {
	date: string;
	close: number;
	volume: number;
	sma50: number | null;
	sma200: number | null;
}

/** Simple moving average of the `period` values ending at index `end` (inclusive), or null. */
export function smaAt(values: number[], period: number, end: number): number | null {
	if (end + 1 < period) return null;
	let sum = 0;
	for (let i = end - period + 1; i <= end; i++) sum += values[i];
	return sum / period;
}

export function buildPriceSeries(
	candles: { date: string; close: number; volume: number }[],
	bars = 252
): PricePoint[] {
	const usable = candles.filter((c) => Number.isFinite(c.close) && c.close > 0);
	const closes = usable.map((c) => c.close);
	const start = Math.max(0, usable.length - bars);
	const out: PricePoint[] = [];
	for (let i = start; i < usable.length; i++) {
		out.push({
			date: usable[i].date.slice(0, 10),
			close: usable[i].close,
			volume: Number.isFinite(usable[i].volume) ? usable[i].volume : 0,
			sma50: smaAt(closes, 50, i),
			sma200: smaAt(closes, 200, i)
		});
	}
	return out;
}

/** How far the latest close is above (+) or below (-) its 200-day average, in percent. */
export function gapTo200(points: PricePoint[]): number | null {
	const last = points[points.length - 1];
	return last?.sma200 ? (last.close / last.sma200 - 1) * 100 : null;
}
