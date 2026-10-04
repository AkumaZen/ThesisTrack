import { describe, it, expect } from 'vitest';
import { assessBusinessQuality } from './businessQuality';

const baseInput = {
	pros: [] as string[],
	cons: [] as string[],
	shareholding: null,
	balanceSheet: null,
	cashConversionCycle: null,
	roe: null
};

describe('assessBusinessQuality', () => {
	it('rates a clean business with no flags as Strong', () => {
		const result = assessBusinessQuality({ ...baseInput, roe: 18 });
		expect(result.rating).toBe('Strong');
		expect(result.flags).toHaveLength(0);
	});

	it('flags promoter selling as bad when the drop is >= 0.5pp', () => {
		const result = assessBusinessQuality({
			...baseInput,
			shareholding: { promoters: 49, promotersPrevQuarter: 50 }
		});
		expect(result.flags.some((f) => f.tone === 'bad' && f.text.includes('fell'))).toBe(true);
	});

	it('flags promoter buying as good when the rise is >= 0.5pp', () => {
		const result = assessBusinessQuality({
			...baseInput,
			shareholding: { promoters: 51, promotersPrevQuarter: 50 }
		});
		expect(result.flags.some((f) => f.tone === 'good' && f.text.includes('rose'))).toBe(true);
	});

	it('does not flag promoter holding changes smaller than the 0.5pp threshold', () => {
		const result = assessBusinessQuality({
			...baseInput,
			shareholding: { promoters: 50.2, promotersPrevQuarter: 50 }
		});
		expect(result.flags.some((f) => f.text.includes('Promoter'))).toBe(false);
	});

	it('flags high leverage (borrowings > 50% of total assets) as bad', () => {
		const result = assessBusinessQuality({
			...baseInput,
			balanceSheet: { borrowings: 600, totalAssets: 1000 }
		});
		expect(result.flags.some((f) => f.tone === 'bad' && f.text.includes('leveraged'))).toBe(true);
	});

	it('does not flag leverage at exactly 50% or below', () => {
		const result = assessBusinessQuality({
			...baseInput,
			balanceSheet: { borrowings: 500, totalAssets: 1000 }
		});
		expect(result.flags.some((f) => f.text.includes('leveraged'))).toBe(false);
	});

	it('flags a long cash conversion cycle (> 180 days) as bad', () => {
		const result = assessBusinessQuality({ ...baseInput, cashConversionCycle: 200 });
		const flag = result.flags.find((f) => f.text.includes('200 days'));
		expect(flag?.tone).toBe('bad');
	});

	it('flags low ROE (< 10%) as a warning, not bad', () => {
		const result = assessBusinessQuality({ ...baseInput, roe: 6 });
		const flag = result.flags.find((f) => f.text.includes('ROE'));
		expect(flag?.tone).toBe('warn');
	});

	it('rates Caution when any bad flag is present', () => {
		const result = assessBusinessQuality({
			...baseInput,
			balanceSheet: { borrowings: 600, totalAssets: 1000 } // 1 bad flag
		});
		expect(result.rating).toBe('Caution');
	});

	it('rates Caution when 3+ warn flags accumulate even with no bad flags', () => {
		const result = assessBusinessQuality({
			...baseInput,
			pros: [],
			cons: ['Con 1', 'Con 2', 'Con 3'], // cons map to warn-tone flags
			roe: 25
		});
		expect(result.rating).toBe('Caution');
	});

	it('rates Watch with 1-2 warn flags and no bad flags', () => {
		const result = assessBusinessQuality({ ...baseInput, roe: 6 }); // 1 warn flag
		expect(result.rating).toBe('Watch');
	});

	it('passes through pros as good flags and cons as warn flags verbatim', () => {
		const result = assessBusinessQuality({
			...baseInput,
			pros: ['Strong ROCE'],
			cons: ['High debt']
		});
		expect(result.flags).toContainEqual({ tone: 'good', text: 'Strong ROCE' });
		expect(result.flags).toContainEqual({ tone: 'warn', text: 'High debt' });
	});
});
