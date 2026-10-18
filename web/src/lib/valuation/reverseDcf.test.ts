import { describe, expect, it } from 'vitest';
import { dcfValue, historicCagr, solveImpliedGrowth, type DcfInputs } from './reverseDcf';

const base: DcfInputs = { baseEarnings: 100, discountRate: 0.12, terminalGrowth: 0.04, years: 10 };

describe('dcfValue', () => {
	it('with zero growth equals an annuity plus terminal value (hand computed)', () => {
		// 10 years of 100 at 12%: 100 * (1 - 1.12^-10) / 0.12 = 565.0223; terminal = 100*1.04/0.08 = 1300, PV 1300/1.12^10 = 418.5632
		expect(dcfValue(0, base)).toBeCloseTo(565.0223 + 418.5632, 2);
	});
});

describe('solveImpliedGrowth', () => {
	it('recovers the growth used to build the market cap', () => {
		const cap = dcfValue(0.18, base);
		const r = solveImpliedGrowth(cap, base);
		expect(r.kind).toBe('ok');
		if (r.kind === 'ok') expect(r.growth).toBeCloseTo(0.18, 6);
	});

	it('gives a negative growth for a market cap below the no-growth value', () => {
		const r = solveImpliedGrowth(500, base);
		expect(r.kind).toBe('ok');
		if (r.kind === 'ok') expect(r.growth).toBeLessThan(0);
	});

	it('reports out-of-range prices instead of a number', () => {
		expect(solveImpliedGrowth(1e12, base).kind).toBe('above-range');
		expect(solveImpliedGrowth(1, base).kind).toBe('below-range');
	});

	it('rejects unusable inputs', () => {
		expect(solveImpliedGrowth(0, base).kind).toBe('invalid');
		expect(solveImpliedGrowth(1000, { ...base, baseEarnings: -5 }).kind).toBe('invalid');
		expect(solveImpliedGrowth(1000, { ...base, terminalGrowth: 0.12 }).kind).toBe('invalid');
		expect(solveImpliedGrowth(1000, { ...base, years: 0 }).kind).toBe('invalid');
	});

	it('a higher discount rate needs more growth to justify the same price', () => {
		const cap = 2500;
		const a = solveImpliedGrowth(cap, base);
		const b = solveImpliedGrowth(cap, { ...base, discountRate: 0.15 });
		if (a.kind !== 'ok' || b.kind !== 'ok') throw new Error('expected solutions');
		expect(b.growth).toBeGreaterThan(a.growth);
	});
});

describe('historicCagr', () => {
	it('compounds the last N years', () => {
		expect(historicCagr([100, 110, 121, 133.1], 3)).toBeCloseTo(0.1, 6);
	});
	it('is null with too little or non-positive history', () => {
		expect(historicCagr([100, 110], 3)).toBeNull();
		expect(historicCagr([-5, 10, 20, 30], 3)).toBeNull();
	});
});
