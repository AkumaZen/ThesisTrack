import { describe, expect, it } from 'vitest';
import { buildPriceSeries, gapTo200, smaAt } from './priceChart';

const candles = (n: number, f: (i: number) => number = (i) => 100 + i) =>
	Array.from({ length: n }, (_, i) => ({
		date: `2025-01-01T00:00:00+05:30`.replace('01-01', `01-${String((i % 28) + 1).padStart(2, '0')}`),
		close: f(i),
		volume: 1000 + i
	}));

describe('smaAt', () => {
	it('averages exactly the trailing window and is null before it is full', () => {
		expect(smaAt([1, 2, 3, 4, 5], 3, 4)).toBe(4);
		expect(smaAt([1, 2, 3, 4, 5], 3, 1)).toBeNull();
		expect(smaAt([1, 2, 3, 4, 5], 5, 4)).toBe(3);
	});
});

describe('buildPriceSeries', () => {
	it('returns only the last `bars` sessions but computes averages from earlier history', () => {
		const s = buildPriceSeries(candles(451), 252);
		expect(s).toHaveLength(252);
		// The first plotted point is session 199: its 200-day average uses sessions 0..199, all
		// of which lie before or at the window start.
		expect(s[0].sma200).toBeCloseTo(100 + 99.5, 6);
		expect(s.every((p) => p.sma50 != null && p.sma200 != null)).toBe(true);
	});

	it('leaves the 200-day average empty until 200 sessions exist, instead of faking it', () => {
		const s = buildPriceSeries(candles(120), 252);
		expect(s).toHaveLength(120);
		expect(s[100].sma50).not.toBeNull();
		expect(s.every((p) => p.sma200 === null)).toBe(true);
	});

	it('drops bad closes and trims dates to the day', () => {
		const s = buildPriceSeries([{ date: '2025-03-04T00:00:00+05:30', close: 10, volume: NaN }, { date: 'x', close: 0, volume: 1 }]);
		expect(s).toEqual([{ date: '2025-03-04', close: 10, volume: 0, sma50: null, sma200: null }]);
	});
});

describe('gapTo200', () => {
	it('is the percent distance of the close from the 200-day average', () => {
		const s = buildPriceSeries(candles(300, () => 100).map((c, i) => (i === 299 ? { ...c, close: 110 } : c)));
		expect(gapTo200(s)).toBeCloseTo((110 / ((199 * 100 + 110) / 200) - 1) * 100, 6);
		expect(gapTo200(buildPriceSeries(candles(50)))).toBeNull();
	});
});
