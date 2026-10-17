import { describe, expect, it } from 'vitest';
import { targetProgress } from './priceTarget';

describe('targetProgress', () => {
	it('computes upside, progress and the yearly return still needed', () => {
		const r = targetProgress(100, 150, 200);
		expect(r.state).toBe('in_progress');
		expect(r.progressPct).toBe(50);
		expect(r.barPct).toBe(50);
		expect(r.upsidePct).toBeCloseTo(33.333, 2);
		expect(r.requiredAnnualPct).toBeCloseTo(15.47, 2); // (200/150)^(1/2) - 1
	});

	it('reached when the price is at or above the target', () => {
		for (const cmp of [200, 250]) {
			const r = targetProgress(100, cmp, 200);
			expect(r.state).toBe('reached');
			expect(r.barPct).toBe(100);
			expect(r.requiredAnnualPct).toBeNull();
		}
		expect(targetProgress(100, 250, 200).upsidePct).toBe(-20);
	});

	it('below entry: real negative progress, bar clamped to 0', () => {
		const r = targetProgress(100, 80, 200);
		expect(r.state).toBe('below_entry');
		expect(r.progressPct).toBeCloseTo(-20);
		expect(r.barPct).toBe(0);
	});

	it('target at or below entry draws no bar', () => {
		for (const target of [100, 90]) {
			const r = targetProgress(100, 80, target);
			expect(r.state).toBe('target_below_entry');
			expect(r.barPct).toBeNull();
			expect(r.progressPct).toBeNull();
			expect(r.upsidePct).not.toBeNull();
		}
	});

	it('missing prices', () => {
		expect(targetProgress(100, null, 200).state).toBe('no_current');
		expect(targetProgress(100, 0, 200).state).toBe('no_current');
		const r = targetProgress(null, 150, 200);
		expect(r.state).toBe('no_entry');
		expect(r.upsidePct).toBeCloseTo(33.333, 2);
		expect(r.barPct).toBeNull();
	});
});
