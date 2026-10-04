/** Simple moving average of `values` over `window` entries. Entries before a full window is
 *  available are null, so a short history draws no average rather than a misleading one. */
export function sma(values: number[], window: number): (number | null)[] {
	const out: (number | null)[] = new Array(values.length).fill(null);
	if (window < 1 || values.length < window) return out;
	let sum = 0;
	for (let i = 0; i < values.length; i++) {
		sum += values[i];
		if (i >= window) sum -= values[i - window];
		if (i >= window - 1) out[i] = sum / window;
	}
	return out;
}

/** The last `count` values to draw, with their moving average worked out over the whole history
 *  first - so the average is complete across the visible stretch whenever there are `window`
 *  sessions behind its start. `average` lines up one-to-one with `points`. */
export function windowWithAverage(
	values: number[],
	count: number,
	window = 200
): { points: number[]; average: (number | null)[] } {
	const start = Math.max(0, values.length - count);
	return { points: values.slice(start), average: sma(values, window).slice(start) };
}
