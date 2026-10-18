import { describe, expect, it } from 'vitest';
import {
	computePresetMetrics,
	countPresets,
	hasCurrentPresets,
	matchedPresets,
	passesPreset,
	percentileRanks,
	presetDetail,
	quarterlyGrowth,
	rsBasis,
	type PresetId,
	type PresetMetrics
} from './presetScans';
import type { Candle } from './stageScan';

function candle(i: number, close: number, volume = 1000, high = close): Candle {
	return { date: new Date(Date.UTC(2024, 0, 1 + i)).toISOString().slice(0, 10), open: close, high, low: close, close, volume };
}

/** n flat sessions at `price`. */
function flat(n: number, price = 100, volume = 1000): Candle[] {
	return Array.from({ length: n }, (_, i) => candle(i, price, volume));
}

function metrics(over: Partial<PresetMetrics> = {}): PresetMetrics {
	return {
		sessions: 300,
		close: 100,
		prevClose: 99,
		high52: 100,
		volume: 1000,
		avgVolume50: 1000,
		breakoutAge: null,
		breakoutLevel: null,
		ret3m: 10,
		ret6m: 20,
		bench3m: 2,
		bench6m: 4,
		...over
	};
}

describe('computePresetMetrics', () => {
	it('returns null with no candles', () => {
		expect(computePresetMetrics([], null)).toBeNull();
	});

	it('leaves windows empty when the history is too short', () => {
		const m = computePresetMetrics(flat(10), null)!;
		expect(m.sessions).toBe(10);
		expect(m.avgVolume50).toBeNull();
		expect(m.ret3m).toBeNull();
		expect(m.ret6m).toBeNull();
		expect(m.breakoutAge).toBeNull();
		expect(m.bench3m).toBeNull();
	});

	it('averages the 50 sessions before the latest, not including it', () => {
		const candles = flat(60, 100, 1000);
		candles[59] = candle(59, 100, 9000);
		const m = computePresetMetrics(candles, null)!;
		expect(m.avgVolume50).toBe(1000);
		expect(m.volume).toBe(9000);
	});

	it('takes the 52-week high from intraday highs of the last 252 sessions', () => {
		const candles = flat(300, 100);
		candles[10] = candle(10, 100, 1000, 500); // older than 252 sessions: ignored
		candles[100] = candle(100, 100, 1000, 130);
		expect(computePresetMetrics(candles, null)!.high52).toBe(130);
	});

	it('computes 3 and 6 month returns and the index returns', () => {
		const candles = flat(200, 100);
		candles[199] = candle(199, 120);
		const index = Array.from({ length: 200 }, () => 1000);
		index[199] = 1050;
		const m = computePresetMetrics(candles, index)!;
		expect(m.ret3m).toBeCloseTo(20);
		expect(m.ret6m).toBeCloseTo(20);
		expect(m.bench3m).toBeCloseTo(5);
		expect(m.bench6m).toBeCloseTo(5);
	});

	it('skips a return whose starting close is zero', () => {
		const candles = flat(200, 100);
		candles[199 - 63] = candle(0, 0);
		expect(computePresetMetrics(candles, null)!.ret3m).toBeNull();
	});

	it('finds a breakout above the prior 50-day high, with its age', () => {
		const candles = flat(80, 100);
		candles[79] = candle(79, 110, 1000, 111);
		let m = computePresetMetrics(candles, null)!;
		expect(m.breakoutAge).toBe(0);
		expect(m.breakoutLevel).toBe(100);

		candles[78] = candle(78, 110, 1000, 111);
		candles[79] = candle(79, 112, 1000, 113);
		// Yesterday's close (110) also cleared 100, but today's (112) is the latest breakout day.
		m = computePresetMetrics(candles, null)!;
		expect(m.breakoutAge).toBe(0);
		// Today closes above 111 = prior high, day 79 qualifies; make it not: age 1 only.
		candles[79] = candle(79, 110.5, 1000, 111);
		m = computePresetMetrics(candles, null)!;
		expect(m.breakoutAge).toBe(1);
	});

	it('does not call an old breakout fresh', () => {
		const candles = flat(80, 100);
		candles[70] = candle(70, 110, 1000, 111);
		for (let i = 71; i < 80; i++) candles[i] = candle(i, 112, 1000, 113);
		expect(computePresetMetrics(candles, null)!.breakoutAge).toBeNull();
	});

	it('does not look for a breakout with fewer than 50 prior sessions', () => {
		const candles = flat(40, 100);
		candles[39] = candle(39, 150);
		expect(computePresetMetrics(candles, null)!.breakoutAge).toBeNull();
	});
});

describe('stage 2 preset', () => {
	it('passes Advancing and Confirmed Breakout, not Near Breakout or missing', () => {
		expect(passesPreset('stage2', { stage: 'Stage 2 Advancing', metrics: null })).toBe(true);
		expect(passesPreset('stage2', { stage: 'Confirmed Stage 2 Breakout', metrics: null })).toBe(true);
		expect(passesPreset('stage2', { stage: 'Near Stage 2 Breakout', metrics: null })).toBe(false);
		expect(passesPreset('stage2', { stage: 'Stage 4', metrics: null })).toBe(false);
		expect(passesPreset('stage2', { stage: null, metrics: null })).toBe(false);
	});
});

describe('near 52-week high preset', () => {
	const run = (m: Partial<PresetMetrics>) => passesPreset('near-high', { stage: null, metrics: metrics(m) });
	it('passes within 5% and at the high', () => {
		expect(run({ close: 95, high52: 100 })).toBe(true);
		expect(run({ close: 100, high52: 100 })).toBe(true);
	});
	it('fails just beyond 5%', () => {
		expect(run({ close: 94.9, high52: 100 })).toBe(false);
	});
	it('fails with too little history or no high', () => {
		expect(run({ sessions: 150 })).toBe(false);
		expect(run({ high52: null })).toBe(false);
		expect(run({ high52: 0 })).toBe(false);
		expect(passesPreset('near-high', { stage: null, metrics: null })).toBe(false);
	});
});

describe('volume surge preset', () => {
	const run = (m: Partial<PresetMetrics>) => passesPreset('volume-surge', { stage: null, metrics: metrics(m) });
	it('passes at exactly 2x and above', () => {
		expect(run({ volume: 2000, avgVolume50: 1000 })).toBe(true);
		expect(run({ volume: 5000, avgVolume50: 1000 })).toBe(true);
	});
	it('fails below 2x', () => {
		expect(run({ volume: 1999, avgVolume50: 1000 })).toBe(false);
	});
	it('fails on zero volume, a zero average, or no average', () => {
		expect(run({ volume: 0, avgVolume50: 1000 })).toBe(false);
		expect(run({ volume: 500, avgVolume50: 0 })).toBe(false);
		expect(run({ volume: 500, avgVolume50: null })).toBe(false);
		expect(passesPreset('volume-surge', { stage: null, metrics: undefined })).toBe(false);
	});
});

describe('relative strength preset', () => {
	const run = (m: Partial<PresetMetrics>, rank?: { r3m: number; r6m: number } | null) =>
		passesPreset('relative-strength', { stage: null, metrics: metrics(m), universeRank: rank });

	it('beats the Nifty 500 by 5 points on both windows', () => {
		expect(run({ ret3m: 8, bench3m: 3, ret6m: 14, bench6m: 9 })).toBe(true);
	});
	it('fails when one window falls short', () => {
		expect(run({ ret3m: 7.9, bench3m: 3, ret6m: 30, bench6m: 9 })).toBe(false);
		expect(run({ ret3m: 30, bench3m: 3, ret6m: 13.9, bench6m: 9 })).toBe(false);
	});
	it('fails with missing stock returns', () => {
		expect(run({ ret3m: null })).toBe(false);
		expect(run({ ret6m: null })).toBe(false);
	});
	it('uses the universe rank when no index is stored, and says so', () => {
		const noIndex = { bench3m: null, bench6m: null };
		expect(rsBasis(metrics(noIndex))).toBe('universe');
		expect(rsBasis(metrics())).toBe('nifty500');
		expect(run(noIndex, { r3m: 85, r6m: 80 })).toBe(true);
		expect(run(noIndex, { r3m: 85, r6m: 79 })).toBe(false);
		expect(run(noIndex, null)).toBe(false);
	});
	it('ignores the universe rank when the index is stored', () => {
		expect(run({ ret3m: 1, bench3m: 3 }, { r3m: 99, r6m: 99 })).toBe(false);
	});
});

describe('fresh breakout preset', () => {
	const run = (m: Partial<PresetMetrics>) => passesPreset('fresh-breakout', { stage: null, metrics: metrics(m) });
	it('passes while the close is still above the broken level', () => {
		expect(run({ breakoutAge: 0, breakoutLevel: 99, close: 100 })).toBe(true);
		expect(run({ breakoutAge: 2, breakoutLevel: 100, close: 100 })).toBe(true);
	});
	it('fails once price fell back under the level, or with no breakout', () => {
		expect(run({ breakoutAge: 1, breakoutLevel: 101, close: 100 })).toBe(false);
		expect(run({ breakoutAge: null })).toBe(false);
	});
});

describe('quarterlyGrowth', () => {
	const q = (label: string, sales: number | null, netProfit: number | null) => ({ label, sales, netProfit });
	const series = [
		q('Jun 2025', 100, 10),
		q('Sep 2025', 110, 12),
		q('Dec 2025', 120, 14),
		q('Mar 2026', 130, 16),
		q('Jun 2026', 125, 15)
	];

	it('compares the latest quarter with the one a year before', () => {
		const g = quarterlyGrowth(series)!;
		expect(g.label).toBe('Jun 2026');
		expect(g.salesYoY).toBeCloseTo(25);
		expect(g.profitYoY).toBeCloseTo(50);
	});
	it('is null with fewer than five quarters or none', () => {
		expect(quarterlyGrowth(series.slice(1))).toBeNull();
		expect(quarterlyGrowth([])).toBeNull();
		expect(quarterlyGrowth(null)).toBeNull();
	});
	it('is null when the quarter a year ago is not in the series', () => {
		const gap = [series[0], series[1], series[2], q('Jun 2026', 125, 15), q('Sep 2026', 1, 1)];
		expect(quarterlyGrowth(gap)).toBeNull();
		expect(quarterlyGrowth(series.map((s) => ({ ...s, label: 'FY26' })))).toBeNull();
	});
	it('leaves growth null for a missing or non-positive base', () => {
		const loss = [q('Jun 2025', 100, -5), ...series.slice(1, 4), q('Jun 2026', 125, 15)];
		const g = quarterlyGrowth(loss)!;
		expect(g.profitYoY).toBeNull();
		expect(g.salesYoY).toBeCloseTo(25);
		const missing = [q('Jun 2025', null, 10), ...series.slice(1, 4), q('Jun 2026', 125, null)];
		const g2 = quarterlyGrowth(missing)!;
		expect(g2.salesYoY).toBeNull();
		expect(g2.profitYoY).toBeNull();
	});
});

describe('growth + stage 2 preset', () => {
	const growth = (salesYoY: number | null, profitYoY: number | null) => ({ label: 'Jun 2026', salesYoY, profitYoY });
	const run = (stage: 'Stage 2 Advancing' | 'Stage 4', g: ReturnType<typeof growth> | null) =>
		passesPreset('growth-stage2', { stage, metrics: metrics(), growth: g });

	it('needs Stage 2 and both growth figures at 15% or more', () => {
		expect(run('Stage 2 Advancing', growth(15, 15))).toBe(true);
		expect(run('Stage 2 Advancing', growth(14.9, 40))).toBe(false);
		expect(run('Stage 2 Advancing', growth(40, 14.9))).toBe(false);
		expect(run('Stage 4', growth(40, 40))).toBe(false);
	});
	it('does not match without stored quarterly results', () => {
		expect(run('Stage 2 Advancing', null)).toBe(false);
		expect(run('Stage 2 Advancing', growth(null, 40))).toBe(false);
		expect(run('Stage 2 Advancing', growth(40, null))).toBe(false);
	});
});

describe('matchedPresets', () => {
	it('lists every preset that passes, in catalogue order', () => {
		const ids = matchedPresets({
			stage: 'Stage 2 Advancing',
			metrics: metrics({ volume: 3000, ret3m: 20, bench3m: 2, ret6m: 30, bench6m: 4 }),
			growth: { label: 'Jun 2026', salesYoY: 30, profitYoY: 30 }
		});
		expect(ids).toEqual(['stage2', 'near-high', 'volume-surge', 'relative-strength', 'growth-stage2']);
	});
	it('is empty for a stock with no data at all', () => {
		expect(matchedPresets({ stage: null, metrics: null })).toEqual([]);
	});
});

describe('percentileRanks', () => {
	it('ranks the non-null values from 0 to 100', () => {
		const r = percentileRanks(new Map([['A', 10], ['B', 20], ['C', 30], ['D', null], ['E', 40]]));
		expect(r.get('A')).toBe(0);
		expect(r.get('E')).toBe(100);
		expect(r.get('C')).toBeCloseTo(66.67, 1);
		expect(r.has('D')).toBe(false);
	});
	it('handles a single value and an empty map', () => {
		expect(percentileRanks(new Map([['A', 5]])).get('A')).toBe(100);
		expect(percentileRanks(new Map()).size).toBe(0);
	});
});

describe('presetDetail', () => {
	it('describes each preset from its numbers and is empty without them', () => {
		const input = { stage: 'Stage 2 Advancing' as const, metrics: metrics({ volume: 3000, breakoutAge: 1, breakoutLevel: 98 }) };
		expect(presetDetail('volume-surge', input)).toContain('3.0x');
		expect(presetDetail('fresh-breakout', input)).toContain('1d ago');
		expect(presetDetail('relative-strength', input)).toContain('vs Nifty 500');
		expect(presetDetail('near-high', input)).toContain('52W high');
		expect(presetDetail('volume-surge', { stage: null, metrics: null })).toBe('');
		expect(presetDetail('growth-stage2', { stage: null, metrics: null })).toBe('');
	});
});

describe('technical presets', () => {
	const tech = (over: Partial<NonNullable<PresetMetrics['tech']>> = {}): NonNullable<PresetMetrics['tech']> => ({
		rsi14: 50,
		adx14: 20,
		plusDI: 20,
		minusDI: 15,
		superTrend: { dir: 1, flipAge: 30, value: 90 },
		goldenCross: { fast: 105, slow: 100, crossAgeWeeks: 20 },
		...over
	});
	const input = (t: ReturnType<typeof tech> | undefined, extra: Partial<Parameters<typeof passesPreset>[1]> = {}) => ({
		stage: 'Stage 1 Base' as const,
		metrics: metrics({ close: 98, tech: t }),
		...extra
	});

	it('RSI oversold at 30 or below, strong at 60 or above', () => {
		expect(passesPreset('rsi-oversold', input(tech({ rsi14: 30 })))).toBe(true);
		expect(passesPreset('rsi-oversold', input(tech({ rsi14: 30.1 })))).toBe(false);
		expect(passesPreset('rsi-strong', input(tech({ rsi14: 60 })))).toBe(true);
		expect(passesPreset('rsi-strong', input(tech({ rsi14: 59.9 })))).toBe(false);
		expect(passesPreset('rsi-strong', input(tech({ rsi14: null })))).toBe(false);
	});

	it('ADX trend needs ADX 25+ with +DI above -DI', () => {
		expect(passesPreset('adx-trend', input(tech({ adx14: 25, plusDI: 30, minusDI: 10 })))).toBe(true);
		expect(passesPreset('adx-trend', input(tech({ adx14: 24.9, plusDI: 30, minusDI: 10 })))).toBe(false);
		expect(passesPreset('adx-trend', input(tech({ adx14: 40, plusDI: 10, minusDI: 30 })))).toBe(false);
	});

	it('SuperTrend buy: bullish and flipped within the last 10 sessions', () => {
		expect(passesPreset('supertrend-buy', input(tech({ superTrend: { dir: 1, flipAge: 9, value: 90 } })))).toBe(true);
		expect(passesPreset('supertrend-buy', input(tech({ superTrend: { dir: 1, flipAge: 10, value: 90 } })))).toBe(false);
		expect(passesPreset('supertrend-buy', input(tech({ superTrend: { dir: -1, flipAge: 2, value: 90 } })))).toBe(false);
		expect(passesPreset('supertrend-buy', input(tech({ superTrend: { dir: 1, flipAge: null, value: 90 } })))).toBe(false);
	});

	it('golden cross: crossed within the last 8 weeks and still above', () => {
		expect(passesPreset('golden-cross', input(tech({ goldenCross: { fast: 1, slow: 1, crossAgeWeeks: 7 } })))).toBe(true);
		expect(passesPreset('golden-cross', input(tech({ goldenCross: { fast: 1, slow: 1, crossAgeWeeks: 8 } })))).toBe(false);
		expect(passesPreset('golden-cross', input(tech({ goldenCross: null })))).toBe(false);
	});

	it('5-year high: close within 2% of the stored high, never without one', () => {
		expect(passesPreset('five-year-high', input(tech(), { high5y: 100 }))).toBe(true); // 98 vs 100
		expect(passesPreset('five-year-high', input(tech(), { high5y: 100.1 }))).toBe(false);
		expect(passesPreset('five-year-high', input(tech(), { high5y: null }))).toBe(false);
		expect(passesPreset('five-year-high', input(tech()))).toBe(false);
	});

	it('results stored before the technical numbers existed count as out of date', () => {
		expect(hasCurrentPresets({ presets: metrics() })).toBe(false);
		expect(hasCurrentPresets({ presets: metrics({ tech: tech() }) })).toBe(true);
		expect(hasCurrentPresets({ presets: null })).toBe(true);
		expect(hasCurrentPresets({})).toBe(false);
	});

	it('detail lines say why', () => {
		expect(presetDetail('rsi-oversold', input(tech({ rsi14: 28.04 })))).toBe('RSI(14) 28.0');
		expect(presetDetail('five-year-high', input(tech(), { high5y: 100 }))).toContain('2.0% below the 5Y high');
	});
});

describe('countPresets', () => {
	it('counts every symbol given, whatever stage tab is on screen', () => {
		const matched = new Map<string, PresetId[]>([
			['A', ['stage2', 'rsi-strong']],
			['B', ['rsi-strong']],
			['C', ['golden-cross']]
		]);
		const all = countPresets(['A', 'B', 'C'], matched);
		expect(all['rsi-strong']).toBe(2);
		expect(all['stage2']).toBe(1);
		expect(all['golden-cross']).toBe(1);
		expect(all['high-roce']).toBe(0);
		// Symbols outside the list are not counted.
		expect(countPresets(['B'], matched)['rsi-strong']).toBe(1);
	});
});
