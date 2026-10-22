import { describe, expect, it } from 'vitest';
import { formatDataThrough, oldestLastDay } from './priceAge';

const series = (...days: string[]) => days.map((d) => `${d}T00:00:00+05:30`);

describe('oldestLastDay', () => {
	it('is the oldest last-candle date, so one stale stock holds the card back', () => {
		expect(oldestLastDay([series('2026-10-15', '2026-10-21'), series('2026-10-15', '2026-10-16')])).toBe('2026-10-16');
	});

	it('ignores stocks with no candles and is null when none have any', () => {
		expect(oldestLastDay([[], series('2026-10-21')])).toBe('2026-10-21');
		expect(oldestLastDay([[], []])).toBeNull();
		expect(oldestLastDay([])).toBeNull();
	});
});

describe('formatDataThrough', () => {
	it('formats a calendar date without a time zone shift', () => {
		expect(formatDataThrough('2026-10-16')).toBe('16 Oct');
		expect(formatDataThrough('2026-01-05')).toBe('5 Jan');
		expect(formatDataThrough('2026-12-31')).toBe('31 Dec');
	});
});
