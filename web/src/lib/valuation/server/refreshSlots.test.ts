import { describe, expect, it } from 'vitest';
import { dueRefreshSlot } from './refreshSlots';

// 2026-10-05 is a Monday. India time is UTC+5:30.
const ist = (date: string, hhmm: string) => new Date(`${date}T${hhmm}:00+05:30`);

describe('dueRefreshSlot', () => {
	it('names the slot during the hour after each of the four moments', () => {
		expect(dueRefreshSlot(ist('2026-10-05', '09:30'))).toBe('2026-10-05T09:30');
		expect(dueRefreshSlot(ist('2026-10-05', '10:29'))).toBe('2026-10-05T09:30');
		expect(dueRefreshSlot(ist('2026-10-05', '12:45'))).toBe('2026-10-05T12:30');
		expect(dueRefreshSlot(ist('2026-10-05', '15:31'))).toBe('2026-10-05T15:30');
		expect(dueRefreshSlot(ist('2026-10-05', '16:55'))).toBe('2026-10-05T16:30');
	});

	it('is null between the slots and overnight', () => {
		expect(dueRefreshSlot(ist('2026-10-05', '09:29'))).toBeNull();
		expect(dueRefreshSlot(ist('2026-10-05', '11:00'))).toBeNull();
		expect(dueRefreshSlot(ist('2026-10-05', '17:30'))).toBeNull();
		expect(dueRefreshSlot(ist('2026-10-05', '02:00'))).toBeNull();
	});

	it('is null on weekends', () => {
		expect(dueRefreshSlot(ist('2026-10-03', '12:30'))).toBeNull(); // Saturday
		expect(dueRefreshSlot(ist('2026-10-04', '12:30'))).toBeNull(); // Sunday
	});

	it('uses the India date, not the UTC date', () => {
		// 09:30 IST on Monday is 04:00 UTC on Monday; 02:00 IST Tuesday is still Monday in UTC.
		expect(dueRefreshSlot(new Date('2026-10-05T04:00:00Z'))).toBe('2026-10-05T09:30');
		expect(dueRefreshSlot(new Date('2026-10-05T20:30:00Z'))).toBeNull(); // 02:00 IST Tuesday
	});
});
