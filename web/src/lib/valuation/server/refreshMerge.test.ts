import { describe, expect, it } from 'vitest';
import type { Candle, DayQuote } from './angelone';
import { chunk, classifyGap, isProvisionalQuote, mergeQuote, previousSession, previousWeekday } from './refreshMerge';

const candle = (day: string, close: number, extra: Partial<Candle> = {}): Candle => ({
	date: `${day}T00:00:00+05:30`,
	open: close,
	high: close,
	low: close,
	close,
	volume: 100,
	...extra
});
const quote = (date: string, extra: Partial<DayQuote> = {}): DayQuote => ({
	symbol: 'X',
	date,
	open: 101,
	high: 106,
	low: 99,
	ltp: 104,
	prevClose: 100,
	volume: 5000,
	...extra
});
// 2026-10-16 is a Friday, 10-17 a Saturday, 10-19 a Monday.
const afterClose = new Date('2026-10-19T12:00:00Z'); // 17:30 IST
const midSession = new Date('2026-10-19T06:00:00Z'); // 11:30 IST

describe('gap detection', () => {
	it('previous weekday skips the weekend', () => {
		expect(previousWeekday('2026-10-19')).toBe('2026-10-16');
		expect(previousWeekday('2026-10-20')).toBe('2026-10-19');
	});
	it('Friday to Monday is an append, not a gap', () => {
		expect(classifyGap('2026-10-16', '2026-10-19')).toBe('append');
	});
	it('same or newer stored day is current', () => {
		expect(classifyGap('2026-10-19', '2026-10-19')).toBe('current');
		expect(classifyGap('2026-10-20', '2026-10-19')).toBe('current');
	});
	it('a missed session (or a holiday in between) is a gap', () => {
		expect(classifyGap('2026-10-15', '2026-10-19')).toBe('gap');
		expect(classifyGap('2026-10-14', '2026-10-16')).toBe('gap');
	});
});

describe('holiday-aware sessions', () => {
	// 2026-10-20 (Tuesday) was an exchange holiday.
	const cal = ['2026-10-15', '2026-10-16', '2026-10-19', '2026-10-21'];
	it('previousSession skips a holiday using the calendar', () => {
		expect(previousSession('2026-10-21', cal)).toBe('2026-10-19');
		expect(previousSession('2026-10-19', cal)).toBe('2026-10-16');
	});
	it('falls back to previousWeekday without a calendar or when it is stale', () => {
		expect(previousSession('2026-10-21')).toBe('2026-10-20');
		expect(previousSession('2026-10-21', [])).toBe('2026-10-20');
		expect(previousSession('2026-10-21', cal.slice(0, 3))).toBe('2026-10-20');
	});
	it('a calendar ending the weekday before the quote day is trusted', () => {
		expect(previousSession('2026-10-21', ['2026-10-19', '2026-10-20'])).toBe('2026-10-20');
	});
	it('classifyGap appends over a holiday but a real missed session stays a gap', () => {
		expect(classifyGap('2026-10-19', '2026-10-21', cal)).toBe('append');
		expect(classifyGap('2026-10-19', '2026-10-21')).toBe('gap');
		expect(classifyGap('2026-10-16', '2026-10-21', cal)).toBe('gap');
	});
	it('mergeQuote appends across the holiday and keeps the corporate-action guard', () => {
		const now = new Date('2026-10-21T12:00:00Z');
		const r = mergeQuote([candle('2026-10-19', 100)], quote('2026-10-21'), now, cal);
		expect(r.kind).toBe('appended');
		const split = mergeQuote([candle('2026-10-19', 100)], quote('2026-10-21', { open: 40, prevClose: 40 }), now, cal);
		expect(split).toEqual({ kind: 'full', reason: 'corporate-action' });
		expect(mergeQuote([candle('2026-10-19', 100)], quote('2026-10-21'), now)).toEqual({ kind: 'full', reason: 'gap' });
	});
});

describe('isProvisionalQuote', () => {
	it('is provisional during the session and until 16:00 IST', () => {
		expect(isProvisionalQuote('2026-10-19', midSession)).toBe(true);
		expect(isProvisionalQuote('2026-10-19', new Date('2026-10-19T10:00:00Z'))).toBe(true); // 15:30 IST
	});
	it('is final after 16:00 IST, on weekends, and for an earlier session', () => {
		expect(isProvisionalQuote('2026-10-19', afterClose)).toBe(false);
		expect(isProvisionalQuote('2026-10-17', new Date('2026-10-17T06:00:00Z'))).toBe(false);
		expect(isProvisionalQuote('2026-10-16', midSession)).toBe(false);
	});
});

describe('mergeQuote', () => {
	it('appends the new session and settles yesterday with the quote prevClose', () => {
		const stored = [candle('2026-10-15', 98), candle('2026-10-16', 99.5, { provisional: true })];
		const r = mergeQuote(stored, quote('2026-10-19', { prevClose: 100 }), afterClose);
		if (r.kind !== 'appended') throw new Error(r.kind);
		expect(r.candles).toHaveLength(3);
		expect(r.candles[1]).toMatchObject({ close: 100 });
		expect(r.candles[1].provisional).toBeUndefined();
		expect(r.candles[2]).toMatchObject({
			date: '2026-10-19T00:00:00+05:30',
			open: 101,
			high: 106,
			low: 99,
			close: 104,
			volume: 5000
		});
		expect(r.candles[2].provisional).toBeUndefined();
	});
	it('marks the appended candle provisional during the session', () => {
		const r = mergeQuote([candle('2026-10-16', 100)], quote('2026-10-19'), midSession);
		if (r.kind !== 'appended') throw new Error(r.kind);
		expect(r.candles.at(-1)?.provisional).toBe(true);
	});
	it('replaces a provisional candle of the same session', () => {
		const stored = [candle('2026-10-16', 100), candle('2026-10-19', 102, { provisional: true })];
		const r = mergeQuote(stored, quote('2026-10-19', { ltp: 105 }), afterClose);
		if (r.kind !== 'appended') throw new Error(r.kind);
		expect(r.candles).toHaveLength(2);
		expect(r.candles[1]).toMatchObject({ close: 105 });
		expect(r.candles[1].provisional).toBeUndefined();
	});
	it('leaves a final candle of the same session alone', () => {
		const stored = [candle('2026-10-16', 100), candle('2026-10-19', 104)];
		expect(mergeQuote(stored, quote('2026-10-19'), afterClose)).toEqual({ kind: 'unchanged' });
	});
	it('is unchanged when the market has not moved on (weekend quote of Friday)', () => {
		const r = mergeQuote([candle('2026-10-16', 100)], quote('2026-10-16'), new Date('2026-10-17T06:00:00Z'));
		expect(r).toEqual({ kind: 'unchanged' });
	});
	it('never stores a weekend-dated quote (Saturday feed time over Friday figures)', () => {
		const stored = [candle('2026-10-15', 99), candle('2026-10-16', 100)];
		const sunday = new Date('2026-10-18T06:00:00Z');
		expect(mergeQuote(stored, quote('2026-10-17'), sunday)).toEqual({ kind: 'unchanged' });
		expect(mergeQuote(stored, quote('2026-10-18'), sunday)).toEqual({ kind: 'unchanged' });
	});
	it('falls back to a full fetch for an empty series or a gap', () => {
		expect(mergeQuote([], quote('2026-10-19'), afterClose)).toEqual({ kind: 'full', reason: 'empty' });
		expect(mergeQuote([candle('2026-10-14', 100)], quote('2026-10-19'), afterClose)).toEqual({
			kind: 'full',
			reason: 'gap'
		});
	});
	it('guards against a corporate action: open far from the last stored close', () => {
		const r = mergeQuote([candle('2026-10-16', 100)], quote('2026-10-19', { open: 50, prevClose: 50, ltp: 51 }), afterClose);
		expect(r).toEqual({ kind: 'full', reason: 'corporate-action' });
	});
	it('guards on the quote prevClose too (adjusted before the open)', () => {
		const r = mergeQuote([candle('2026-10-16', 100)], quote('2026-10-19', { open: 0, prevClose: 50, ltp: 50 }), afterClose);
		expect(r).toEqual({ kind: 'full', reason: 'corporate-action' });
	});
	it('accepts a move just under 20 percent', () => {
		const r = mergeQuote([candle('2026-10-16', 100)], quote('2026-10-19', { open: 119, prevClose: 100 }), afterClose);
		expect(r.kind).toBe('appended');
	});
	it('uses ltp when the open is zero and keeps high/low consistent', () => {
		const r = mergeQuote(
			[candle('2026-10-16', 100)],
			quote('2026-10-19', { open: 0, high: 0, low: 0, ltp: 101 }),
			afterClose
		);
		if (r.kind !== 'appended') throw new Error(r.kind);
		expect(r.candles.at(-1)).toMatchObject({ open: 101, high: 101, low: 101, close: 101 });
	});
	it('drops history older than 700 days', () => {
		const r = mergeQuote([candle('2024-01-02', 90), candle('2026-10-16', 100)], quote('2026-10-19'), afterClose);
		if (r.kind !== 'appended') throw new Error(r.kind);
		expect(r.candles.map((c) => c.date.slice(0, 10))).toEqual(['2026-10-16', '2026-10-19']);
	});
});

describe('chunk', () => {
	it('splits into runs of at most the size, keeping order', () => {
		expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
		expect(chunk([], 50)).toEqual([]);
		expect(chunk(Array.from({ length: 101 }, (_, i) => i), 50).map((c) => c.length)).toEqual([50, 50, 1]);
	});
});
