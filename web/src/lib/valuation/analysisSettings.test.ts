import { describe, it, expect } from 'vitest';
import {
	DEFAULT_ANALYSIS_SETTINGS,
	parseAnalysisSettings,
	storedAnalysisSettings
} from './analysisSettings';
import { computeSectorReturns, type Candle as RotationCandle } from './sectorRotation';
import { computeStructuralResult, DEFAULT_SCAN_PARAMS, type Candle } from './stageScan';

describe('parseAnalysisSettings', () => {
	it('fills a partial update from the current values', () => {
		const r = parseAnalysisSettings({ scan: { breakoutVolumeRatio: 2.5 } });
		expect('value' in r && r.value.scan.breakoutVolumeRatio).toBe(2.5);
		expect('value' in r && r.value.rotation).toEqual(DEFAULT_ANALYSIS_SETTINGS.rotation);
	});

	it('rejects out-of-range, fractional-day and inconsistent values with a readable message', () => {
		expect(parseAnalysisSettings({ scan: { breakoutVolumeRatio: 9 } })).toEqual({
			error: 'Breakout volume must be between 1 and 5 x average.'
		});
		expect(parseAnalysisSettings({ scan: { minBaseDurationDays: 30.5 } })).toEqual({
			error: 'Minimum base length must be a whole number of trading days.'
		});
		expect(parseAnalysisSettings({ rotation: { shortDays: 63, midDays: 63 } })).toEqual({
			error: 'The rotation windows must go short < medium < long.'
		});
		expect(
			parseAnalysisSettings({ scan: { elevatedVolumeRatio: 3, breakoutVolumeRatio: 2 } })
		).toEqual({ error: 'Elevated volume cannot be higher than breakout volume.' });
		expect(parseAnalysisSettings({ valuation: { fairValuePct: 120 } })).toEqual({
			error: 'Fair value must be between 50 and 100 % of target.'
		});
		expect(parseAnalysisSettings({ scan: { cleanBreakMarginPct: '2' } })).toEqual({
			error: 'Breakout margin must be a number.'
		});
	});

	it('falls back to the defaults for a missing or corrupt stored value', () => {
		expect(storedAnalysisSettings(undefined)).toEqual(DEFAULT_ANALYSIS_SETTINGS);
		expect(storedAnalysisSettings({ scan: { breakoutVolumeRatio: -1 } })).toEqual(
			DEFAULT_ANALYSIS_SETTINGS
		);
	});
});

describe('settings change the calculations', () => {
	it('a higher minimum relative strength keeps a modest leader out of Rotating In', () => {
		const closes = [100];
		for (let i = 1; i <= 73; i++) closes.push(100);
		for (const [rate, days] of [
			[0.0005, 63],
			[0.0015, 42],
			[0.004, 21]
		] as const) {
			for (let i = 0; i < days; i++) closes.push(closes[closes.length - 1] * (1 + rate));
		}
		const asCandles = (cs: number[]): RotationCandle[] =>
			cs.map((close, i) => ({
				date: `d${String(i).padStart(3, '0')}`,
				open: close,
				high: close,
				low: close,
				close,
				volume: 0
			}));
		const sector = { key: 's', label: 'S', candles: asCandles(closes) };
		const nifty = asCandles(Array(200).fill(100));
		const rotation = DEFAULT_ANALYSIS_SETTINGS.rotation;

		expect(computeSectorReturns([sector], nifty, rotation)[0].signal).toBe('Rotating In');
		// The last month is ~+8.7% vs a flat Nifty: below a 10-point bar, so no signal.
		expect(computeSectorReturns([sector], nifty, { ...rotation, minRsPct: 10 })[0].signal).toBe(
			'Neutral'
		);
	});

	it('a stricter breakout volume rule rejects a 3x-volume breakout', () => {
		const bar = (i: number, close: number, volume = 100_000): Candle => ({
			date: new Date(Date.UTC(2023, 0, 2 + i)).toISOString().slice(0, 10),
			open: close,
			high: close,
			low: close,
			close,
			volume
		});
		const candles: Candle[] = [];
		for (let i = 0; i < 219; i++) candles.push(bar(i, 95 + 5 * Math.sin((2 * Math.PI * i) / 20)));
		candles.push(bar(219, 103, 300_000));

		const normal = computeStructuralResult(candles, null);
		expect(normal.stage).toBe('Confirmed Stage 2 Breakout');
		const strict = computeStructuralResult(candles, null, {
			...DEFAULT_SCAN_PARAMS,
			breakoutVolumeRatio: 4
		});
		expect(strict.breakout).toBeNull();
		expect(strict.stage).not.toBe('Confirmed Stage 2 Breakout');
		expect(strict.paramsKey).not.toBe(normal.paramsKey);
	});
});
