import { describe, expect, it } from 'vitest';
import {
	adxSeries,
	computeTechnicalMetrics,
	goldenCross,
	rsiSeries,
	smaSeries,
	superTrendSeries,
	weeklyCloses
} from './indicators';
import type { Candle } from './stageScan';

/** A smooth, deterministic price path; the expected numbers below came from a separate reference
 *  implementation (plain Python, textbook Wilder formulas) run on exactly this path. */
function wave(n: number): Candle[] {
	return Array.from({ length: n }, (_, i) => {
		const close = 100 + 10 * Math.sin(i / 7) + 0.05 * i;
		return {
			date: `2024-01-${String((i % 28) + 1).padStart(2, '0')}`,
			open: close,
			high: close + 1 + 0.5 * Math.abs(Math.sin(i)),
			low: close - 1 - 0.5 * Math.abs(Math.cos(i)),
			close,
			volume: 1000
		};
	});
}

describe('rsiSeries', () => {
	// The closing prices and RSI(14) values of the widely published StockCharts RSI worked example.
	const closes = [
		44.3389, 44.0902, 44.1497, 43.6124, 44.3278, 44.8264, 45.0955, 45.4245, 45.8433, 46.0826, 45.8931, 46.0328,
		45.614, 46.282, 46.282, 46.0028, 46.0328, 46.4116, 46.2222, 45.6439, 46.2122, 46.2521, 45.7137, 46.4515,
		45.7835, 45.3548, 44.0288, 44.1783, 44.222, 44.5675, 43.4205, 42.6628, 43.1314
	];
	const published = [70.53, 66.32, 66.55, 69.41, 66.36, 57.97, 62.93, 63.26, 56.06, 62.38, 54.71, 50.42, 39.99];

	it('matches the published values', () => {
		const rsi = rsiSeries(closes);
		published.forEach((v, k) => expect(rsi[14 + k]).toBeCloseTo(v, 1));
	});

	it('is null until 14 changes exist and the series keeps its length', () => {
		const rsi = rsiSeries(closes);
		expect(rsi).toHaveLength(closes.length);
		expect(rsi.slice(0, 14).every((v) => v === null)).toBe(true);
		expect(rsiSeries(closes.slice(0, 14)).every((v) => v === null)).toBe(true);
	});

	it('is 100 on a straight climb, 0 on a straight fall and 50 when nothing moves', () => {
		expect(rsiSeries(Array.from({ length: 30 }, (_, i) => 100 + i)).at(-1)).toBe(100);
		expect(rsiSeries(Array.from({ length: 30 }, (_, i) => 100 - i)).at(-1)).toBe(0);
		expect(rsiSeries(Array.from({ length: 30 }, () => 100)).at(-1)).toBe(50);
	});
});

describe('adxSeries', () => {
	const adx = adxSeries(wave(120));
	it('matches the reference implementation', () => {
		expect(adx[27]).toMatchObject({});
		const at = (i: number) => adx[i]!;
		expect(at(27).adx).toBeCloseTo(36.244804, 4);
		expect(at(27).plusDI).toBeCloseTo(11.204191, 4);
		expect(at(27).minusDI).toBeCloseTo(27.965734, 4);
		expect(at(28).adx).toBeCloseTo(37.065113, 4);
		expect(at(60).adx).toBeCloseTo(50.684255, 4);
		expect(at(119).adx).toBeCloseTo(45.778333, 4);
		expect(at(119).plusDI).toBeCloseTo(6.644863, 4);
		expect(at(119).minusDI).toBeCloseTo(29.419373, 4);
	});
	it('starts at index 2 * 14 - 1', () => {
		expect(adx[26]).toBeNull();
		expect(adx[27]).not.toBeNull();
	});
	it('is high with +DI over -DI in a steady uptrend', () => {
		const up: Candle[] = Array.from({ length: 60 }, (_, i) => ({
			date: `d${i}`, open: 100 + i, high: 101 + i, low: 99 + i, close: 100 + i, volume: 1
		}));
		const last = adxSeries(up).at(-1)!;
		expect(last.adx).toBeGreaterThan(90);
		expect(last.plusDI).toBeGreaterThan(last.minusDI);
	});
	it('returns nulls with too little history', () => {
		expect(adxSeries(wave(20)).every((v) => v === null)).toBe(true);
	});
});

describe('superTrendSeries', () => {
	const st = superTrendSeries(wave(120));
	it('matches the reference implementation', () => {
		expect(st[9]).toBeNull();
		expect(st[10]!.value).toBeCloseTo(102.284293, 4);
		expect(st[10]!.dir).toBe(1);
		expect(st[40]!.value).toBeCloseTo(99.647305, 4);
		expect(st[40]!.dir).toBe(-1);
		expect(st[119]!.value).toBeCloseTo(104.207755, 4);
		expect(st[119]!.dir).toBe(-1);
	});
	it('flips where the reference does', () => {
		const flips: number[] = [];
		for (let i = 11; i < st.length; i++) if (st[i]!.dir !== st[i - 1]!.dir) flips.push(i);
		expect(flips).toEqual([21, 43, 65, 87, 109]);
	});
	it('trails below price when bullish and above it when bearish', () => {
		const candles = wave(120);
		st.forEach((p, i) => {
			if (!p) return;
			if (p.dir === 1) expect(p.value).toBeLessThan(candles[i].close);
			else expect(p.value).toBeGreaterThan(candles[i].close);
		});
	});
});

describe('weekly closes and the golden cross', () => {
	/** Five trading days a week from Monday 2024-01-01; `closeOfWeek(w)` is that week's close on every day. */
	function weeks(count: number, closeOfWeek: (w: number) => number): Candle[] {
		const out: Candle[] = [];
		for (let w = 0; w < count; w++)
			for (let d = 0; d < 5; d++) {
				const date = new Date(Date.UTC(2024, 0, 1 + w * 7 + d)).toISOString().slice(0, 10);
				const close = closeOfWeek(w);
				out.push({ date, open: close, high: close, low: close, close, volume: 1 });
			}
		return out;
	}

	it('takes the last close of each ISO week', () => {
		const c: Candle[] = [
			{ date: '2024-01-05', close: 1 }, // Friday
			{ date: '2024-01-08', close: 2 }, // Monday
			{ date: '2024-01-12', close: 3 } // Friday
		].map((x) => ({ ...x, open: 0, high: 0, low: 0, volume: 0 }));
		expect(weeklyCloses(c)).toEqual([
			{ week: '2024-01-01', close: 1 },
			{ week: '2024-01-08', close: 3 }
		]);
	});

	it('smooths with a simple average', () => {
		expect(smaSeries([1, 2, 3, 4], 2)).toEqual([null, 1.5, 2.5, 3.5]);
	});

	it('dates the cross and reports both averages', () => {
		// 30 flat weeks, then a step up in week 30: the 10-week average passes the 30-week one that week.
		const gc = goldenCross(weeks(36, (w) => (w < 30 ? 100 : 110)))!;
		expect(gc.crossAgeWeeks).toBe(5);
		expect(gc.fast).toBeCloseTo((100 * 4 + 110 * 6) / 10, 6);
		expect(gc.slow).toBeCloseTo((100 * 24 + 110 * 6) / 30, 6);
	});

	it('reports no cross while the fast average is below the slow one', () => {
		const gc = goldenCross(weeks(40, (w) => (w < 30 ? 100 : 90)))!;
		expect(gc.fast).toBeLessThan(gc.slow);
		expect(gc.crossAgeWeeks).toBeNull();
	});

	it('needs more than 30 weeks of closes', () => {
		expect(goldenCross(weeks(30, () => 100))).toBeNull();
	});
});

describe('computeTechnicalMetrics', () => {
	it('summarises the latest values', () => {
		const m = computeTechnicalMetrics(wave(120));
		expect(m.rsi14).not.toBeNull();
		expect(m.adx14).toBeCloseTo(45.778333, 4);
		expect(m.superTrend).toMatchObject({ dir: -1 });
		// The last flip was at candle 109 of 0..119.
		expect(m.superTrend!.flipAge).toBe(10);
	});
	it('is empty-handed on a short history', () => {
		const m = computeTechnicalMetrics(wave(5));
		expect(m).toMatchObject({ rsi14: null, adx14: null, superTrend: null, goldenCross: null });
	});
});
