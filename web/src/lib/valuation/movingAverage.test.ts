import { describe, expect, it } from 'vitest';
import { sma, windowWithAverage } from './movingAverage';

describe('sma', () => {
	it('is null until a full window exists, then the mean of the last window values', () => {
		expect(sma([1, 2, 3, 4, 5], 3)).toEqual([null, null, 2, 3, 4]);
	});

	it('is all null when there is less history than the window', () => {
		expect(sma([1, 2], 3)).toEqual([null, null]);
		expect(sma([], 3)).toEqual([]);
	});

	it('matches a direct calculation over a longer series', () => {
		const values = Array.from({ length: 300 }, (_, i) => 100 + Math.sin(i / 7) * 10 + i * 0.1);
		const out = sma(values, 200);
		const direct = values.slice(100, 300).reduce((a, b) => a + b, 0) / 200;
		expect(out[299]).toBeCloseTo(direct, 9);
		expect(out[198]).toBeNull();
		expect(out[199]).not.toBeNull();
	});
});

describe('windowWithAverage', () => {
	it('draws the last count values with an average computed over the whole history', () => {
		const values = Array.from({ length: 451 }, (_, i) => i + 1);
		const { points, average } = windowWithAverage(values, 252, 200);
		expect(points).toHaveLength(252);
		expect(average).toHaveLength(252);
		expect(average.every((v) => v != null)).toBe(true); // 199 sessions behind the first drawn one
		expect(average[251]).toBeCloseTo((252 + 451) / 2, 9); // mean of the last 200 values, 252..451
	});

	it('leaves the early part empty when the history is shorter than window plus count', () => {
		const values = Array.from({ length: 270 }, (_, i) => i + 1);
		const { average } = windowWithAverage(values, 252, 200);
		expect(average[0]).toBeNull();
		expect(average[251]).not.toBeNull();
		expect(average.filter((v) => v == null)).toHaveLength(199 - 18); // first full window at index 199
	});

	it('copes with fewer values than requested', () => {
		const { points, average } = windowWithAverage([1, 2, 3], 252, 200);
		expect(points).toEqual([1, 2, 3]);
		expect(average).toEqual([null, null, null]);
	});
});
