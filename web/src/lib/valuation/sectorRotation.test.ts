import { describe, it, expect } from 'vitest';
import { computeSectorReturns, buildEqualWeightedIndex, rotationBadge, type Candle } from './sectorRotation';

// Builds a daily-candle series with a given close-price path (one entry per trading day).
function candles(closes: number[]): Candle[] {
	return closes.map((close, i) => ({
		date: `2026-01-${String(i + 1).padStart(2, '0')}`,
		open: close,
		high: close,
		low: close,
		close,
		volume: 1000
	}));
}

// 200 trading days, flat at 100 — a stable benchmark to diff sector moves against.
const flatNifty = candles(Array(200).fill(100));

describe('computeSectorReturns', () => {
	it('computes 0% return for a flat price series', () => {
		const sector = { key: 'flat', label: 'Flat Sector', candles: candles(Array(200).fill(50)) };
		const [result] = computeSectorReturns([sector], flatNifty);
		expect(result.return1w).toBeCloseTo(0);
		expect(result.return1m).toBeCloseTo(0);
		expect(result.return3m).toBeCloseTo(0);
		expect(result.return6m).toBeCloseTo(0);
	});

	it('computes positive relative strength when a sector outperforms a flat Nifty', () => {
		// Sector rises from 100 to 150 over 200 days (steady climb); Nifty is flat.
		const path = Array.from({ length: 200 }, (_, i) => 100 + (i / 199) * 50);
		const sector = { key: 'winner', label: 'Winner', candles: candles(path) };
		const [result] = computeSectorReturns([sector], flatNifty);
		expect(result.return6m).toBeGreaterThan(0);
		expect(result.rs6m).toBeGreaterThan(0); // outperformed a flat benchmark
	});

	it('computes weekly relative strength (5 trading days) against the benchmark', () => {
		// Flat at 100, then a 10% rise in the final week; Nifty is flat.
		const path = [...Array(195).fill(100), 102, 104, 106, 108, 110];
		const sector = { key: 'wk', label: 'Weekly', candles: candles(path) };
		const [result] = computeSectorReturns([sector], flatNifty);
		expect(result.return1w).toBeCloseTo(10);
		expect(result.rs1w).toBeCloseTo(10);

		// If the benchmark also rose 4% that week, relative strength is the difference.
		const nifty = candles([...Array(195).fill(100), 101, 102, 103, 104, 104]);
		const [vs] = computeSectorReturns([sector], nifty);
		expect(vs.rs1w).toBeCloseTo(6);
	});

	it('has no weekly relative strength without enough history', () => {
		const [result] = computeSectorReturns(
			[{ key: 's', label: 'S', candles: candles(Array(4).fill(100)) }],
			flatNifty
		);
		expect(result.rs1w).toBeNull();
	});

	it('returns null for windows longer than the available history instead of throwing', () => {
		const shortSeries = candles(Array(10).fill(100)); // far short of the 126-day 6M window
		const sector = { key: 'short', label: 'Short History', candles: shortSeries };
		const shortNifty = candles(Array(10).fill(100));
		const [result] = computeSectorReturns([sector], shortNifty);
		expect(result.return6m).toBeNull();
		expect(result.rs6m).toBeNull();
	});

	// Builds a 200-day path with 3 consecutive constant-rate regimes: a 74-day flat lead-in
	// (outside every measured window, so it can't affect the result), then a 63-day, a 42-day,
	// and a final 21-day regime at the given daily rates — i.e. the rate in effect for each of
	// the 6M/3M/1M lookback windows respectively.
	function multiRegimePath(startPrice: number, rates: [number, number, number]): number[] {
		const prices = [startPrice];
		for (let i = 1; i <= 73; i++) prices.push(startPrice);
		for (const [rate, days] of [
			[rates[0], 63],
			[rates[1], 42],
			[rates[2], 21]
		] as const) {
			for (let i = 0; i < days; i++) prices.push(prices[prices.length - 1] * (1 + rate));
		}
		return prices;
	}

	it('flags "Rotating In" when RS *per day* accelerates and is positive (not just cumulative RS, which is biased toward longer windows)', () => {
		// Rate genuinely increases over time: 0.05%/day -> 0.15%/day -> 0.4%/day.
		const path = multiRegimePath(100, [0.0005, 0.0015, 0.004]);
		const sector = { key: 'surging', label: 'Surging', candles: candles(path) };
		const [result] = computeSectorReturns([sector], flatNifty);
		expect(result.signal).toBe('Rotating In');
	});

	it('flags "Rotating Out" when RS per day fades and is negative', () => {
		const path = multiRegimePath(200, [-0.0005, -0.0015, -0.004]);
		const sector = { key: 'fading', label: 'Fading', candles: candles(path) };
		const [result] = computeSectorReturns([sector], flatNifty);
		expect(result.signal).toBe('Rotating Out');
	});

	it('reads Neutral for a genuinely constant daily growth rate — cumulative returns over longer windows are naturally bigger from compounding alone, which must not be misread as deceleration', () => {
		const path = multiRegimePath(100, [0.002, 0.002, 0.002]); // same rate throughout
		const sector = { key: 'steady', label: 'Steady', candles: candles(path) };
		const [result] = computeSectorReturns([sector], flatNifty);
		// Sanity: cumulative 6M return is indeed larger than 1M (compounding), but that's not
		// deceleration — the per-day rate never changed, so the signal must read Neutral.
		expect(result.return6m!).toBeGreaterThan(result.return1m!);
		expect(result.signal).toBe('Neutral');
	});

	it('reads Neutral when the rate zigzags rather than trending consistently', () => {
		const path = Array.from({ length: 200 }, (_, i) => 100 + Math.sin(i / 5) * 10);
		const sector = { key: 'zigzag', label: 'Zigzag', candles: candles(path) };
		const [result] = computeSectorReturns([sector], flatNifty);
		expect(result.signal).toBe('Neutral');
	});

	it('preserves the key and label for each sector in order', () => {
		const results = computeSectorReturns(
			[
				{ key: 'a', label: 'Sector A', candles: flatNifty },
				{ key: 'b', label: 'Sector B', candles: flatNifty }
			],
			flatNifty
		);
		expect(results.map((r) => r.key)).toEqual(['a', 'b']);
		expect(results.map((r) => r.label)).toEqual(['Sector A', 'Sector B']);
	});
});

describe('buildEqualWeightedIndex', () => {
	it('averages normalized closes across stocks on their common dates', () => {
		// Stock A: 100 -> 110 (+10%). Stock B: 200 -> 240 (+20%). Equal-weighted basket should
		// land at +15% on the final date, not skew toward either stock's raw price level.
		const a: Candle[] = [
			{ date: '2026-01-01', open: 100, high: 100, low: 100, close: 100, volume: 0 },
			{ date: '2026-01-02', open: 110, high: 110, low: 110, close: 110, volume: 0 }
		];
		const b: Candle[] = [
			{ date: '2026-01-01', open: 200, high: 200, low: 200, close: 200, volume: 0 },
			{ date: '2026-01-02', open: 240, high: 240, low: 240, close: 240, volume: 0 }
		];
		const index = buildEqualWeightedIndex([a, b]);
		expect(index).toHaveLength(2);
		expect(index[0].close).toBeCloseTo(100);
		expect(index[1].close).toBeCloseTo(115); // (110 + 120) / 2
	});

	it('a recently-listed stock does not shrink the basket window — it just sits out until it exists', () => {
		const long: Candle[] = [
			{ date: '2026-01-01', open: 100, high: 100, low: 100, close: 100, volume: 0 },
			{ date: '2026-01-02', open: 105, high: 105, low: 105, close: 105, volume: 0 },
			{ date: '2026-01-03', open: 110, high: 110, low: 110, close: 110, volume: 0 }
		];
		// Recently listed — history only starts on 2026-01-02.
		const short: Candle[] = [
			{ date: '2026-01-02', open: 50, high: 50, low: 50, close: 50, volume: 0 },
			{ date: '2026-01-03', open: 55, high: 55, low: 55, close: 55, volume: 0 }
		];
		const index = buildEqualWeightedIndex([long, short]);
		// Full window preserved, including the pre-listing date — not truncated to `short`'s range.
		expect(index.map((c) => c.date)).toEqual(['2026-01-01', '2026-01-02', '2026-01-03']);
		expect(index[0].close).toBeCloseTo(100);
		// 2026-01-02: only `long` traded the day before too, so the move is `long`-only (+5%).
		expect(index[1].close).toBeCloseTo(105);
		// 2026-01-03: both traded the prior day — equal-weighted average of +4.76% and +10%.
		expect(index[2].close).toBeCloseTo(105 * (1 + (5 / 105 + 0.1) / 2));
	});

	it('carries the level flat across a date with no constituent overlap, rather than dropping it', () => {
		const a: Candle[] = [{ date: '2026-01-01', open: 1, high: 1, low: 1, close: 1, volume: 0 }];
		const b: Candle[] = [{ date: '2026-02-01', open: 1, high: 1, low: 1, close: 1, volume: 0 }];
		const index = buildEqualWeightedIndex([a, b]);
		expect(index.map((c) => c.date)).toEqual(['2026-01-01', '2026-02-01']);
		expect(index[0].close).toBeCloseTo(100);
		expect(index[1].close).toBeCloseTo(100);
	});

	it('returns an empty series when given no constituents', () => {
		expect(buildEqualWeightedIndex([])).toEqual([]);
	});
});

describe('rotationBadge', () => {
	const b = (signal: 'Rotating In' | 'Rotating Out' | 'Neutral', rs1m: number | null, rs3m: number | null) =>
		rotationBadge({ signal, rs1m, rs3m }).text;

	it('keeps the strict flips as they are', () => {
		expect(b('Rotating In', 5, 2)).toBe('Rotating In');
		expect(b('Rotating Out', -5, -2)).toBe('Rotating Out');
	});

	it('no longer calls a sector far ahead of Nifty "Neutral"', () => {
		expect(b('Neutral', 12.5, 7)).toBe('Outperforming');
		expect(b('Neutral', -4, -1)).toBe('Underperforming');
	});

	it('describes turns between the 1M and 3M readings', () => {
		expect(b('Neutral', 3, -2)).toBe('Recovering');
		expect(b('Neutral', -3, 2)).toBe('Fading');
	});

	it('falls back to whichever window exists, then to no data', () => {
		expect(b('Neutral', null, 4)).toBe('Outperforming');
		expect(b('Neutral', null, null)).toBe('No data');
	});
});
