import { describe, it, expect } from 'vitest';
import { analyzePeg } from './pegAnalysis';

describe('analyzePeg — real TCS data golden case', () => {
	it('matches the hand-verified TCS PEG read (14.2 P/E, 8.5% CAGR -> PEG 1.66, Fair)', () => {
		const history = [
			{ label: 'Mar 2015', sales: 0, netProfit: 20060 },
			{ label: 'Mar 2016', sales: 0, netProfit: 24338 },
			{ label: 'Mar 2017', sales: 0, netProfit: 26357 },
			{ label: 'Mar 2018', sales: 0, netProfit: 25880 },
			{ label: 'Mar 2019', sales: 0, netProfit: 31562 },
			{ label: 'Mar 2020', sales: 0, netProfit: 32447 },
			{ label: 'Mar 2021', sales: 0, netProfit: 32562 },
			{ label: 'Mar 2022', sales: 0, netProfit: 38449 },
			{ label: 'Mar 2023', sales: 0, netProfit: 42303 },
			{ label: 'Mar 2024', sales: 0, netProfit: 46099 },
			{ label: 'Mar 2025', sales: 0, netProfit: 48797 },
			{ label: 'Mar 2026', sales: 0, netProfit: 49454 }
		];
		const result = analyzePeg({ stockPE: 14.2, history });
		expect(result.patCagrPct).toBeCloseTo(8.55, 1);
		expect(result.peg).toBeCloseTo(1.66, 1);
		expect(result.label).toBe('Fair');
	});
});

describe('analyzePeg — labeling thresholds', () => {
	const flatHistory = (growthPct: number) => {
		const years = 4;
		const base = 100;
		return Array.from({ length: years }, (_, i) => ({
			label: `Y${i}`,
			sales: 0,
			netProfit: base * Math.pow(1 + growthPct / 100, i)
		}));
	};

	it('labels PEG < 1 as Attractive', () => {
		// P/E 10, growth 20% -> PEG 0.5
		const result = analyzePeg({ stockPE: 10, history: flatHistory(20) });
		expect(result.label).toBe('Attractive');
		expect(result.peg).toBeLessThan(1);
	});

	it('labels PEG between 1 and 2 as Fair', () => {
		// P/E 15, growth 10% -> PEG 1.5
		const result = analyzePeg({ stockPE: 15, history: flatHistory(10) });
		expect(result.label).toBe('Fair');
	});

	it('labels PEG > 2 as Expensive', () => {
		// P/E 40, growth 10% -> PEG 4.0
		const result = analyzePeg({ stockPE: 40, history: flatHistory(10) });
		expect(result.label).toBe('Expensive');
	});

	it('returns a null label when growth is flat or negative — PEG is not meaningful', () => {
		const declining = [
			{ label: 'Y0', sales: 0, netProfit: 100 },
			{ label: 'Y1', sales: 0, netProfit: 90 },
			{ label: 'Y2', sales: 0, netProfit: 80 }
		];
		const result = analyzePeg({ stockPE: 20, history: declining });
		expect(result.label).toBeNull();
		expect(result.peg).toBeNull();
	});

	it('returns a null label with fewer than 3 years of profit history', () => {
		const result = analyzePeg({
			stockPE: 20,
			history: [{ label: 'Y0', sales: 0, netProfit: 100 }]
		});
		expect(result.label).toBeNull();
	});

	it('returns a null label when stockPE is missing or non-positive', () => {
		expect(analyzePeg({ stockPE: null, history: flatHistory(10) }).label).toBeNull();
		expect(analyzePeg({ stockPE: 0, history: flatHistory(10) }).label).toBeNull();
		expect(analyzePeg({ stockPE: -5, history: flatHistory(10) }).label).toBeNull();
	});
});
