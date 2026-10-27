import { describe, expect, it } from 'vitest';
import { formatIst, isProvisionalBreadth, passUniverse } from './livePass';

// 2026-10-27 is a Tuesday, 2026-10-24 a Saturday. India time is UTC+5:30.
const ist = (date: string, hhmm: string) => new Date(`${date}T${hhmm}:00+05:30`);

describe('passUniverse', () => {
	it('unions the lists, upper-cases, dedupes and sorts', () => {
		expect(passUniverse(['tcs', 'INFY'], ['infy', 'RELIANCE', ' hdfcbank '], ['TCS', 'AAA'])).toEqual([
			'AAA',
			'HDFCBANK',
			'INFY',
			'RELIANCE',
			'TCS'
		]);
	});

	it('ignores blanks and survives empty lists', () => {
		expect(passUniverse([], [''], ['  '])).toEqual([]);
	});
});

describe('isProvisionalBreadth', () => {
	it('is provisional when computed on the session day before 16:00 IST', () => {
		expect(isProvisionalBreadth('2026-10-27', ist('2026-10-27', '13:30'))).toBe(true);
		expect(isProvisionalBreadth('2026-10-27', ist('2026-10-27', '15:59'))).toBe(true);
	});

	it('is final once computed at or after 16:00 IST, or on a later day', () => {
		expect(isProvisionalBreadth('2026-10-27', ist('2026-10-27', '16:00'))).toBe(false);
		expect(isProvisionalBreadth('2026-10-27', ist('2026-10-27', '16:30'))).toBe(false);
		expect(isProvisionalBreadth('2026-10-27', ist('2026-10-28', '09:20'))).toBe(false);
	});

	it('is final for a past session even if recomputed during the day', () => {
		expect(isProvisionalBreadth('2026-10-26', ist('2026-10-27', '13:30'))).toBe(false);
	});

	it('never marks a weekend date provisional', () => {
		expect(isProvisionalBreadth('2026-10-24', ist('2026-10-24', '13:30'))).toBe(false);
	});

	it('is false with no computed time', () => {
		expect(isProvisionalBreadth('2026-10-27', null)).toBe(false);
		expect(isProvisionalBreadth('2026-10-27', 'not a date')).toBe(false);
	});

	it('uses the IST day, not the UTC day', () => {
		// 00:10 IST on the 27th is still the 26th in UTC.
		expect(isProvisionalBreadth('2026-10-27', ist('2026-10-27', '00:10'))).toBe(true);
	});
});

describe('formatIst', () => {
	it('writes a human date and time in IST', () => {
		expect(formatIst(ist('2026-10-27', '13:30'))).toMatch(/^Tue,? 27 Oct 2026,? 1:30 pm$/i);
	});
});
