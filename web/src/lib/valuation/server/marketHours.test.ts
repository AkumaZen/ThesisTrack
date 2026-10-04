import { describe, it, expect } from 'vitest';
import { isMarketOpenIST } from './marketHours';

// IST = UTC+5:30. Monday 2026-09-21, Saturday 2026-09-26, Sunday 2026-09-27 (confirmed weekdays).
describe('isMarketOpenIST', () => {
	it('is open mid-session on a weekday (10:00 IST)', () => {
		expect(isMarketOpenIST(new Date('2026-09-21T04:30:00Z'))).toBe(true);
	});

	it('is closed before 09:15 IST on a weekday', () => {
		expect(isMarketOpenIST(new Date('2026-09-21T03:30:00Z'))).toBe(false); // 09:00 IST
	});

	it('is open exactly at the 09:15 IST open boundary', () => {
		expect(isMarketOpenIST(new Date('2026-09-21T03:45:00Z'))).toBe(true);
	});

	it('is open one minute before the 15:30 IST close boundary', () => {
		expect(isMarketOpenIST(new Date('2026-09-21T09:59:00Z'))).toBe(true); // 15:29 IST
	});

	it('is closed exactly at the 15:30 IST close boundary (end exclusive)', () => {
		expect(isMarketOpenIST(new Date('2026-09-21T10:00:00Z'))).toBe(false);
	});

	it('is closed after market close on a weekday', () => {
		expect(isMarketOpenIST(new Date('2026-09-21T10:30:00Z'))).toBe(false); // 16:00 IST
	});

	it('is closed all day Saturday even during normal session hours', () => {
		expect(isMarketOpenIST(new Date('2026-09-26T04:30:00Z'))).toBe(false); // 10:00 IST Sat
	});

	it('is closed all day Sunday even during normal session hours', () => {
		expect(isMarketOpenIST(new Date('2026-09-27T04:30:00Z'))).toBe(false); // 10:00 IST Sun
	});
});
