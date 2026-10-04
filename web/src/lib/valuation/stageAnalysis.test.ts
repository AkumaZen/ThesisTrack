import { describe, it, expect } from 'vitest';
import { computeStageAnalysis, type Candle } from './stageAnalysis';

function candlesFromCloses(closes: number[], volumes?: number[]): Candle[] {
	return closes.map((close, i) => ({
		date: `day-${i}`,
		open: close,
		high: close,
		low: close,
		close,
		volume: volumes?.[i] ?? 100000
	}));
}

describe('computeStageAnalysis', () => {
	it('reports Insufficient Data with fewer than 200 trading days of history', () => {
		const result = computeStageAnalysis(candlesFromCloses(Array(50).fill(100)), null);
		expect(result.stage).toBe('Insufficient Data');
	});

	it('identifies a clean, steady uptrend as Stage 2', () => {
		// 270 days, smoothly rising from 100 to 250 (roughly the shape of a real Stage 2 climb:
		// price above rising 50/150/200-day MAs, well above the 52-week low, near the high).
		const closes = Array.from({ length: 270 }, (_, i) => 100 + (i / 269) * 150);
		const result = computeStageAnalysis(candlesFromCloses(closes), null);
		expect(result.stage).toBe('Stage 2 (Uptrend)');
		expect(result.score).toBeGreaterThanOrEqual(result.totalCriteria - 1);
	});

	it('identifies a steady downtrend as Not in Stage 2 (matches real TCS FY2026 behavior)', () => {
		// Real TCS data this session: CMP 2105 vs 150-day MA 2359.9 / 200-day MA 2567.9, 37%
		// below the 52-week high — a real, verified downtrend read that scored 1/7.
		const closes = Array.from({ length: 270 }, (_, i) => 250 - (i / 269) * 150);
		const result = computeStageAnalysis(candlesFromCloses(closes), null);
		expect(result.stage).toBe('Not in Stage 2');
		// Should fail the MA-stacking and 52-week-high-proximity criteria at minimum.
		expect(result.criteria.some((c) => !c.pass)).toBe(true);
	});

	it('flags a volume-confirmed new 50-day high as a genuine breakout', () => {
		const closes = [...Array(200).fill(100), ...Array(48).fill(105), 108]; // new 50-day high, 249 candles
		const volumes = [...Array(248).fill(10000), 20000]; // 2x average volume on the breakout day (last of 249)
		const result = computeStageAnalysis(candlesFromCloses(closes, volumes), null);
		expect(result.breakoutSignal).toBe(true);
		expect(result.breakoutDetail).toContain('breakout day');
	});

	it('does not flag a new high without volume confirmation as a breakout', () => {
		const closes = [...Array(200).fill(100), ...Array(48).fill(105), 108];
		const result = computeStageAnalysis(candlesFromCloses(closes), null); // flat/average volume throughout
		expect(result.breakoutSignal).toBe(false);
		expect(result.breakoutDetail).toContain('lacks volume confirmation');
	});

	it('reports no breakout when the latest close is not a new 50-day high', () => {
		const closes = [...Array(200).fill(100), ...Array(49).fill(105), 102]; // pulled back
		const result = computeStageAnalysis(candlesFromCloses(closes), null);
		expect(result.breakoutSignal).toBe(false);
		expect(result.breakoutDetail).toBe('No new 50-day high on the latest close.');
	});

	it('adds a relative-strength-vs-Nifty criterion only when index candles are supplied', () => {
		const closes = Array.from({ length: 270 }, (_, i) => 100 + (i / 269) * 50);
		const withoutNifty = computeStageAnalysis(candlesFromCloses(closes), null);
		const withNifty = computeStageAnalysis(candlesFromCloses(closes), candlesFromCloses(closes));
		expect(withoutNifty.totalCriteria).toBe(6);
		expect(withNifty.totalCriteria).toBe(7);
		expect(withNifty.criteria.some((c) => c.label.includes('Nifty'))).toBe(true);
	});

	it('reads outperformance vs Nifty correctly', () => {
		const closes = Array.from({ length: 270 }, (_, i) => 100 + (i / 269) * 50); // stock rises 50%
		const niftyCloses = Array(270).fill(100); // Nifty flat
		const result = computeStageAnalysis(candlesFromCloses(closes), candlesFromCloses(niftyCloses));
		const rsCheck = result.criteria.find((c) => c.label.includes('Nifty'));
		expect(rsCheck?.pass).toBe(true);
	});

	it('computes 52-week high/low and percentage distances correctly', () => {
		const closes = [...Array(200).fill(100), ...Array(69).fill(150), 120];
		const result = computeStageAnalysis(candlesFromCloses(closes), null);
		expect(result.week52High).toBeCloseTo(150);
		expect(result.week52Low).toBeCloseTo(100);
		expect(result.pctAboveLow).toBeCloseTo(20); // 120 vs 100 low
		expect(result.pctFromHigh).toBeCloseTo(-20); // 120 vs 150 high
	});
});
