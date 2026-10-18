import { describe, expect, it } from 'vitest';
import { currentHigh5y, summarizeLongRange } from './longRange';

/** One candle per 7 days from `start`, close = index, high = close + 1. */
function weekly(start: string, count: number) {
	const t0 = new Date(`${start}T00:00:00Z`).getTime();
	return Array.from({ length: count }, (_, i) => ({
		date: new Date(t0 + i * 7 * 86_400_000).toISOString().slice(0, 10),
		close: i + 1,
		high: i + 2
	}));
}

describe('summarizeLongRange', () => {
	it('takes the highest high of the last five years and the close three years back', () => {
		// 400 weeks is about 7.7 years, so the first ~2.7 years fall outside the five-year window.
		const candles = weekly('2018-01-01', 400);
		candles[10].high = 10_000; // a spike outside the window: ignored
		candles[300].high = 5_000; // inside the window
		const r = summarizeLongRange(candles)!;
		expect(r.high5y).toBe(5_000);
		expect(r.fromDate).toBe('2018-01-01');
		// Three years before the last candle (index 399) is about 156.4 weeks back: index 242 on or before.
		expect(r.close3yDate).toBe(candles[242].date);
		expect(r.close3y).toBe(243);
	});

	it('uses all of a young listing and has no 3-year close', () => {
		const candles = weekly('2025-06-02', 30);
		const r = summarizeLongRange(candles)!;
		expect(r.high5y).toBe(31);
		expect(r.fromDate).toBe('2025-06-02');
		expect(r.close3y).toBeNull();
		expect(r.close3yDate).toBeNull();
	});

	it('refuses a 3-year close that is more than a week from the mark', () => {
		const candles = [...weekly('2020-01-06', 3), ...weekly('2026-01-05', 3)];
		const r = summarizeLongRange(candles)!;
		expect(r.close3y).toBeNull();
	});

	it('is null without candles', () => {
		expect(summarizeLongRange([])).toBeNull();
	});
});

describe('currentHigh5y', () => {
	it('prefers whichever is higher and tolerates missing values', () => {
		expect(currentHigh5y(100, 120)).toBe(120);
		expect(currentHigh5y(150, 120)).toBe(150);
		expect(currentHigh5y(null, 120)).toBe(120);
		expect(currentHigh5y(null, undefined)).toBeNull();
	});
});
