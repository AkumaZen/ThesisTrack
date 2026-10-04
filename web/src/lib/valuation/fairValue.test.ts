import { describe, expect, it } from 'vitest';
import {
	FAIR_VALUE_FACTOR,
	fairValueFromTarget,
	sideOfFairValue,
	targetForSaved,
	targetPriceFor,
	upsidePct
} from './fairValue';
import { freshAllAssumptions, freshScenario } from './valuationEngine';
import type { SavedValuationRecord } from './savedValuations';

describe('fair value', () => {
	it('defaults to 20% below the base-case target', () => {
		expect(FAIR_VALUE_FACTOR).toBe(0.8);
		expect(fairValueFromTarget(500)).toBe(400);
		expect(fairValueFromTarget(123.45)).toBeCloseTo(98.76, 2);
	});

	it('uses the team setting when one is given', () => {
		expect(fairValueFromTarget(500, 70)).toBe(350);
		expect(fairValueFromTarget(500, 100)).toBe(500);
	});

	it('is null for missing or non-positive targets', () => {
		for (const bad of [null, undefined, 0, -10, NaN, Infinity]) {
			expect(fairValueFromTarget(bad as number | null | undefined)).toBeNull();
		}
	});
});

describe('upsidePct', () => {
	it('is (target - cmp) / cmp in percent', () => {
		expect(upsidePct(500, 400)).toBeCloseTo(25, 6);
		expect(upsidePct(300, 400)).toBeCloseTo(-25, 6);
		expect(upsidePct(400, 400)).toBe(0);
	});

	it('is null when either side is unusable', () => {
		expect(upsidePct(null, 400)).toBeNull();
		expect(upsidePct(500, null)).toBeNull();
		expect(upsidePct(500, 0)).toBeNull();
		expect(upsidePct(NaN, 400)).toBeNull();
	});
});

describe('sideOfFairValue', () => {
	it('treats reaching fair value exactly as at_or_above', () => {
		expect(sideOfFairValue(99.99, 100)).toBe('below');
		expect(sideOfFairValue(100, 100)).toBe('at_or_above');
		expect(sideOfFairValue(120, 100)).toBe('at_or_above');
	});
});

describe('targetPriceFor', () => {
	it("matches the engine's FY+2E implied price (second projected year)", () => {
		// PE: sales 1000 -> +15% twice = 1322.5; expenses 85% -> EBITDA 198.375; tax 25% ->
		// net profit 148.78125; 10 shares -> EPS 14.878125; x20 target PE = 297.5625.
		const base = freshScenario('pe', 'base');
		const target = targetPriceFor('pe', 1000, 0, 10, base);
		expect(target).toBeCloseTo(297.5625, 4);
		expect(fairValueFromTarget(target)).toBeCloseTo(238.05, 2);
	});

	it('is null for a loss-making or empty model instead of a bogus price', () => {
		const loss = freshScenario('pe', 'base');
		for (const y of loss.years) y.expensePct = 120;
		expect(targetPriceFor('pe', 1000, 0, 10, loss)).toBeNull();
		expect(targetPriceFor('pe', 0, 0, 10, freshScenario('pe', 'base'))).toBeNull();
	});
});

describe('targetForSaved', () => {
	const company = {
		cmp: 250,
		bookValuePerShare: 100,
		years: [{ sales: 800 }, { sales: 1000 }],
		history: [],
		balanceSheet: null,
		cashConversionCycle: null,
		industry: 'IT Services'
	};
	const record = (overrides: Partial<SavedValuationRecord> = {}): SavedValuationRecord => ({
		name: 'X',
		lastUpdated: 1,
		assumptions: freshAllAssumptions(),
		shares: 10,
		...overrides
	});

	it('uses the active method, base scenario, last historical sales', () => {
		const r = targetForSaved(record({ activeMethod: 'pe' }), company);
		expect(r?.method).toBe('pe');
		expect(r?.target).toBeCloseTo(297.5625, 4);
	});

	it('honours a different active method', () => {
		const r = targetForSaved(record({ activeMethod: 'mcap_sales' }), company);
		// sales 1322.5 x 3 / 10 shares
		expect(r?.method).toBe('mcap_sales');
		expect(r?.target).toBeCloseTo(396.75, 4);
	});

	it('falls back to the diagnosed method for records without one (older saves/imports)', () => {
		const r = targetForSaved(record(), { ...company, industry: 'Private Sector Bank' });
		expect(r?.method).toBe('pb');
	});

	it('is null when the model cannot produce a positive price', () => {
		expect(targetForSaved(record({ activeMethod: 'pe', shares: 0 }), company)).toBeNull();
	});
});
