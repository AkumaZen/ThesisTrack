import { describe, expect, it } from 'vitest';
import { diffValuations } from './valuationDiff';
import { assumptionsProblem } from './savedValuations';
import { freshAllAssumptions } from './valuationEngine';

const record = () => ({
	assumptions: freshAllAssumptions(),
	shares: 100,
	activeMethod: 'pe' as const,
	activeScenario: 'base' as const
});

describe('diffValuations', () => {
	it('reports nothing for identical valuations', () => {
		expect(diffValuations(record(), record())).toEqual([]);
	});

	it('names the scenario, method, year, field and both values', () => {
		const a = record();
		const b = record();
		const before = a.assumptions.pe.base.years[1].targetMultiple;
		b.assumptions.pe.base.years[1].targetMultiple = before + 2;
		expect(diffValuations(a, b)).toEqual([
			`Base · P/E · FY+2 target multiple: ${before} → ${before + 2}`
		]);
	});

	it('reports every changed value, plus shares and the selected method', () => {
		const a = record();
		const b = record();
		b.assumptions.pb.bull.years[0].revenueGrowthPct = 99;
		b.assumptions.pe.bear.years[2].taxPct = 30;
		b.shares = 120;
		b.activeMethod = 'pb' as unknown as 'pe';
		const lines = diffValuations(a, b);
		expect(lines).toHaveLength(4);
		expect(lines).toContain('Shares outstanding: 100 → 120');
		expect(lines.some((l) => l.startsWith('Bull · P/B · FY+1 revenue growth %'))).toBe(true);
		expect(lines.some((l) => l.startsWith('Selected method: pe → pb'))).toBe(true);
	});

	it('does not throw on a record missing a method', () => {
		const a = record();
		const b = record();
		delete (b.assumptions as Record<string, unknown>).pb;
		expect(() => diffValuations(a, b)).not.toThrow();
	});
});

describe('assumptionsProblem', () => {
	it('accepts a complete model', () => {
		expect(assumptionsProblem(freshAllAssumptions())).toBeNull();
	});
	it('rejects a model missing years, a method, or a finite number', () => {
		expect(assumptionsProblem({ pe: { base: { years: [] } } })).toMatch(/3 years/);
		const noMethod = freshAllAssumptions() as Record<string, unknown>;
		delete noMethod.pb;
		expect(assumptionsProblem(noMethod)).toMatch(/pb/);
		const bad = freshAllAssumptions();
		(bad.pe.base.years[0] as unknown as Record<string, unknown>).taxPct = NaN;
		expect(assumptionsProblem(bad)).toMatch(/taxPct/);
		expect(assumptionsProblem(null)).toMatch(/object/);
	});
});
