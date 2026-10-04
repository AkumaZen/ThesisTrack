import { describe, it, expect } from 'vitest';
import {
	computeStructuralResult,
	combineLiveOverlay,
	detectBase,
	computeMansfieldRS,
	type Candle
} from './stageScan';

function dateAt(i: number): string {
	const base = new Date('2023-01-02'); // a Monday
	base.setDate(base.getDate() + i);
	return base.toISOString().slice(0, 10);
}

function bar(i: number, close: number, volume = 100_000): Candle {
	return { date: dateAt(i), open: close, high: close, low: close, close, volume };
}

/** A long, tight sideways base oscillating between `support` and `resistance` (sine wave,
 *  period 20 days) for `days` bars — gives several time-separated, price-clustered pivot
 *  touches at the top of the range, which is exactly what detectBase looks for. */
function basingSeries(
	days: number,
	support: number,
	resistance: number,
	startVolume = 100_000
): Candle[] {
	const mid = (support + resistance) / 2;
	const amp = (resistance - support) / 2;
	const out: Candle[] = [];
	for (let i = 0; i < days; i++) {
		const close = mid + amp * Math.sin((2 * Math.PI * i) / 20);
		out.push(bar(i, close, startVolume));
	}
	return out;
}

/** Appends a clean breakout day: closes well above resistance on strong volume. */
function breakoutBar(afterIndex: number, resistance: number, volumeMultiple = 3): Candle {
	return bar(afterIndex, resistance * 1.03, 100_000 * volumeMultiple);
}

describe('detectBase', () => {
	it('finds a validated resistance/support from a long tight sideways base', () => {
		const candles = basingSeries(210, 90, 100);
		const base = detectBase(candles);
		expect(base).not.toBeNull();
		expect(base!.resistance).toBeGreaterThan(97);
		expect(base!.resistance).toBeLessThanOrEqual(100.01);
		expect(base!.support).toBeGreaterThanOrEqual(89.9);
		expect(base!.touches).toBeGreaterThanOrEqual(2);
		expect(base!.durationDays).toBeGreaterThanOrEqual(30);
	});

	it('rejects a one-off spike high as a resistance level (no second touch)', () => {
		// Flat, quiet series with a single isolated spike — nothing else comes near it.
		const candles: Candle[] = [];
		for (let i = 0; i < 150; i++) candles.push(bar(i, 50));
		candles[75] = bar(75, 80); // one lone spike, single bar
		const base = detectBase(candles);
		// Either no base at all, or (if the flat 50-level itself clusters) its resistance must
		// not be anywhere near the untouched 80 spike.
		if (base) expect(base.resistance).toBeLessThan(60);
	});

	it('rejects a base whose range is too wide to be a tight consolidation', () => {
		const candles = basingSeries(210, 50, 100); // 100% range, way over the 30% cap
		expect(detectBase(candles)).toBeNull();
	});

	it('rejects a consolidation that is too short to be a meaningful base', () => {
		const candles = basingSeries(20, 90, 100); // well under the 30-day minimum
		expect(detectBase(candles)).toBeNull();
	});

	it('returns null with too little history to evaluate at all', () => {
		expect(detectBase(basingSeries(10, 90, 100))).toBeNull();
	});
});

describe('computeStructuralResult — classification', () => {
	it('reads "Not classified / insufficient data" with fewer than 200 closed days', () => {
		const candles = basingSeries(120, 90, 100);
		const result = computeStructuralResult(candles, null);
		expect(result.stage).toBe('Not classified / insufficient data');
	});

	it('confirms a clean textbook Stage 1 -> 2 breakout, with the correct date/price/volume', () => {
		const base = basingSeries(219, 90, 100);
		const breakout = breakoutBar(219, 100, 3);
		const candles = [...base, breakout];

		const result = computeStructuralResult(candles, null);

		expect(result.base).not.toBeNull();
		expect(result.breakout).not.toBeNull();
		expect(result.breakout!.date).toBe(dateAt(219));
		expect(result.breakout!.price).toBeCloseTo(103, 0);
		expect(result.breakout!.volumeRatio).toBeGreaterThanOrEqual(2);
		expect(result.breakout!.ageDays).toBe(0);
		expect(result.stage).toBe('Confirmed Stage 2 Breakout');
		expect(result.volumeTier).toBe('Breakout-confirmation');
	});

	it('rejects a marginal breakout (small margin, weak volume) as a confirmed breakout', () => {
		const base = basingSeries(219, 90, 100);
		// Only 0.3% above resistance, and only 1.1x average volume — should not qualify.
		const weakBreakout = bar(219, 100.3, 110_000);
		const candles = [...base, weakBreakout];

		const result = computeStructuralResult(candles, null);

		expect(result.breakout).toBeNull();
		expect(result.stage).not.toBe('Confirmed Stage 2 Breakout');
	});

	it('demotes an old breakout (more than 3 closed days ago) to Stage 2 Advancing', () => {
		// A long enough climb (70 days) that the 200-DMA has genuinely turned up by the end —
		// a brief few-day pop isn't enough to move a 200-day average's slope at all.
		const base = basingSeries(150, 90, 100);
		const breakout = breakoutBar(150, 100, 3);
		const advancing: Candle[] = [];
		for (let i = 1; i <= 70; i++) advancing.push(bar(150 + i, 105 + i, 90_000));
		const candles = [...base, breakout, ...advancing];

		const result = computeStructuralResult(candles, null);

		expect(result.breakout).not.toBeNull();
		expect(result.breakout!.ageDays).toBeGreaterThan(3);
		expect(result.sma200Slope).toBe('rising');
		expect(result.stage).toBe('Stage 2 Advancing');
	});

	it('reads Stage 3 for a prior-breakout stock now topping below its recent high', () => {
		// A long stable regime (220 days) so the 200-DMA has fully caught up and reads flat,
		// then a mini-base + breakout + push to a fresh high + a genuine pullback below it —
		// small enough in magnitude that the 200-day average itself stays flat throughout.
		const stable = Array.from({ length: 190 }, (_, i) => bar(i, 200));
		const miniBase = Array.from({ length: 30 }, (_, i) =>
			bar(190 + i, 200 + 3 * Math.sin((2 * Math.PI * i) / 10))
		);
		const breakout = [bar(220, 206, 300_000)];
		const push: Candle[] = [];
		for (let i = 1; i <= 10; i++) push.push(bar(220 + i, 207 + i * 0.5, 90_000)); // -> 212
		const rollover: Candle[] = [];
		for (let i = 1; i <= 20; i++) rollover.push(bar(230 + i, 212 - i * 0.8, 90_000)); // -> 196
		const candles = [...stable, ...miniBase, ...breakout, ...push, ...rollover];

		const result = computeStructuralResult(candles, null);

		expect(result.breakout).not.toBeNull();
		expect(result.sma200Slope).toBe('flat');
		expect(result.stage).toBe('Stage 3');
	});

	it('reads Stage 4 for a sustained decline below a falling 200-DMA', () => {
		const uptrend: Candle[] = [];
		for (let i = 0; i < 220; i++) uptrend.push(bar(i, 100 + i * 0.3, 90_000));
		const decline: Candle[] = [];
		for (let i = 1; i <= 60; i++) decline.push(bar(220 + i, 166 - i * 1.2, 90_000));
		const candles = [...uptrend, ...decline];

		const result = computeStructuralResult(candles, null);

		expect(result.sma200Slope).toBe('falling');
		expect(result.price).toBeLessThan(result.sma200!);
		expect(result.stage).toBe('Stage 4');
	});

	it('flags the pre-breakout volume-surge warning only while still basing, never once broken out', () => {
		const quietBase = basingSeries(214, 90, 100, 100_000);
		const buildingVolume: Candle[] = [];
		for (let i = 0; i < 5; i++) {
			buildingVolume.push(bar(214 + i, 95 + i, 100_000 * 1.6)); // clear 5-day surge, still below resistance
		}
		const candles = [...quietBase, ...buildingVolume];

		const result = computeStructuralResult(candles, null);

		expect(result.stage === 'Stage 1 Base' || result.stage === 'Near Stage 2 Breakout').toBe(true);
		expect(result.volumeSurgeWarning).toBe(true);

		// Once actually broken out, the surge warning no longer applies (it's a pre-breakout
		// signal, not a general volume flag).
		const broken = [...candles, breakoutBar(candles.length, 100, 3)];
		const brokenResult = computeStructuralResult(broken, null);
		expect(brokenResult.stage).toBe('Confirmed Stage 2 Breakout');
		expect(brokenResult.volumeSurgeWarning).toBe(false);
	});

	it('volume tiers land in the right bucket at the 1.5x/2.0x boundaries', () => {
		const flat: Candle[] = [];
		for (let i = 0; i < 219; i++) flat.push(bar(i, 100, 100_000));
		expect(computeStructuralResult([...flat, bar(219, 100, 140_000)], null).volumeTier).toBe(
			'Normal'
		);
		expect(computeStructuralResult([...flat, bar(219, 100, 160_000)], null).volumeTier).toBe(
			'Elevated'
		);
		expect(computeStructuralResult([...flat, bar(219, 100, 210_000)], null).volumeTier).toBe(
			'Breakout-confirmation'
		);
	});
});

describe('computeMansfieldRS', () => {
	it('reads positive/rising RS when a stock outperforms a flat index at an accelerating rate', () => {
		// A *constant* rate of outperformance settles into a flat Mansfield RS (the oscillator
		// is already normalized for steady outperformance) — genuinely rising RS needs the
		// outperformance itself to be accelerating, same idea as sectorRotation.ts's
		// per-day-rate normalization for "Rotating In".
		const stock: number[] = [];
		const index: number[] = [];
		for (let i = 0; i < 230; i++) {
			stock.push(100 + 0.02 * i + 0.0015 * i * i);
			index.push(100);
		}
		const { rs, trend } = computeMansfieldRS(stock, index);
		expect(rs).not.toBeNull();
		expect(rs!).toBeGreaterThan(0);
		expect(trend).toBe('rising');
	});

	it('reads null with fewer than the required ~210 days of overlapping history', () => {
		const stock = Array(100).fill(100);
		const index = Array(100).fill(100);
		expect(computeMansfieldRS(stock, index).rs).toBeNull();
	});

	it('reads roughly flat RS when a stock and its index move in lockstep', () => {
		const stock: number[] = [];
		const index: number[] = [];
		for (let i = 0; i < 230; i++) {
			const v = 100 + Math.sin(i / 10) * 5;
			stock.push(v);
			index.push(v);
		}
		const { rs } = computeMansfieldRS(stock, index);
		expect(rs).not.toBeNull();
		expect(Math.abs(rs!)).toBeLessThan(1);
	});
});

describe('combineLiveOverlay', () => {
	it('never promotes a stock to Confirmed Stage 2 Breakout from intraday price alone', () => {
		const base = basingSeries(219, 90, 100);
		const structural = computeStructuralResult(base, null);
		expect(structural.stage).not.toBe('Confirmed Stage 2 Breakout');

		const live = combineLiveOverlay(structural, {
			fetchedAt: Date.now(),
			livePrice: 110, // well above resistance, intraday only
			liveVolumeSoFar: 500_000,
			sessionFractionElapsed: 0.5
		});

		expect(live.stage).toBe(structural.stage); // classification is untouched by live data
		expect(live.intradayAboveResistance).toBe(true);
		expect(live.effectivePrice).toBe(110);
		expect(live.distanceToBreakoutPct).toBeLessThan(0);
	});

	it('pace-adjusts projected volume from a partial session', () => {
		const base = basingSeries(219, 90, 100);
		const structural = computeStructuralResult(base, null);
		const live = combineLiveOverlay(structural, {
			fetchedAt: Date.now(),
			livePrice: 96,
			liveVolumeSoFar: 50_000,
			sessionFractionElapsed: 0.25
		});
		expect(live.projectedVolume).toBeCloseTo(200_000, 0);
	});

	it('falls back to the last close when there is no live quote', () => {
		const base = basingSeries(219, 90, 100);
		const structural = computeStructuralResult(base, null);
		const result = combineLiveOverlay(structural, null);
		expect(result.effectivePrice).toBe(structural.price);
		expect(result.liveFetchedAt).toBeNull();
		expect(result.projectedVolume).toBeNull();
	});
});
