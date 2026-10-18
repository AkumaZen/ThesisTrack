// The pure rules for bringing a stored daily series up to date from ONE live quote instead of
// re-downloading the whole history: is the stored series a session behind (append), already
// current, or too far behind / suspicious (fall back to a full refetch)? No network, no database,
// so every rule is unit-tested.
import type { Candle, DayQuote } from './angelone';

/** Stored history kept behind the newest session, matching what a full refresh fetches. */
const KEEP_DAYS = 700;
/** A jump bigger than this between sessions is read as a split / bonus, not a price move. */
export const CORPORATE_ACTION_JUMP = 0.2;
/** Quote figures stay provisional until this IST time on the session day (the closing auction and
 *  the official close settle a little after 15:30). */
const SETTLED_AT_IST_MINUTES = 16 * 60;

export type MergeResult =
	| { kind: 'unchanged' }
	| { kind: 'appended'; candles: Candle[] }
	| { kind: 'full'; reason: 'empty' | 'gap' | 'corporate-action' };

const ymd = (d: Date) => d.toISOString().slice(0, 10);

/** The date part of a stored candle ("2026-10-16T00:00:00+05:30" -> "2026-10-16"). */
export const candleDay = (c: Candle) => c.date.slice(0, 10);

/** The previous Monday-Friday day. Exchange holidays are not known here: a holiday in between
 *  reads as a gap, which costs one full refetch and is always correct. */
export function previousWeekday(day: string): string {
	const d = new Date(`${day}T00:00:00Z`);
	do d.setUTCDate(d.getUTCDate() - 1);
	while (d.getUTCDay() === 0 || d.getUTCDay() === 6);
	return ymd(d);
}

/** Saturday or Sunday (the exchanges do not trade; special sessions are not stored as candles). */
export function isWeekend(day: string): boolean {
	const wd = new Date(`${day}T00:00:00Z`).getUTCDay();
	return wd === 0 || wd === 6;
}

/** 'current': the stored series already covers the quote's session. 'append': it ends at the
 *  trading day just before. 'gap': anything else. */
export function classifyGap(lastStoredDay: string, quoteDay: string): 'current' | 'append' | 'gap' {
	if (lastStoredDay >= quoteDay) return 'current';
	return lastStoredDay === previousWeekday(quoteDay) ? 'append' : 'gap';
}

/** IST calendar date, minutes since midnight and weekday (0 = Sunday) for an instant. */
export function istClock(now: Date): { day: string; minutes: number; weekday: number } {
	const shifted = new Date(now.getTime() + 330 * 60_000);
	return {
		day: ymd(shifted),
		minutes: shifted.getUTCHours() * 60 + shifted.getUTCMinutes(),
		weekday: shifted.getUTCDay()
	};
}

/** Whether a quote for `quoteDay` taken at `now` may still change before the session is final. */
export function isProvisionalQuote(quoteDay: string, now: Date): boolean {
	const ist = istClock(now);
	return quoteDay === ist.day && ist.weekday >= 1 && ist.weekday <= 5 && ist.minutes < SETTLED_AT_IST_MINUTES;
}

function jumped(reference: number, next: number): boolean {
	return reference > 0 && next > 0 && Math.abs(next - reference) / reference > CORPORATE_ACTION_JUMP;
}

function quoteToCandle(q: DayQuote, suffix: string, provisional: boolean): Candle {
	const open = q.open > 0 ? q.open : q.ltp;
	const candle: Candle = {
		date: `${q.date}${suffix}`,
		open,
		high: Math.max(q.high, open, q.ltp),
		low: Math.min(q.low > 0 ? q.low : q.ltp, open, q.ltp),
		close: q.ltp,
		volume: q.volume
	};
	if (provisional) candle.provisional = true;
	return candle;
}

/** Applies one quote to a stored series. */
export function mergeQuote(stored: Candle[], q: DayQuote, now: Date = new Date()): MergeResult {
	const last = stored.at(-1);
	if (!last) return { kind: 'full', reason: 'empty' };
	// Outside a trading week the quote endpoint keeps answering with a feed time stamped on the
	// weekend (a re-dated copy of Friday's figures). That is never a session: do not store it.
	if (isWeekend(q.date)) return { kind: 'unchanged' };
	const lastDay = candleDay(last);
	const gap = classifyGap(lastDay, q.date);
	if (gap === 'gap') return { kind: 'full', reason: 'gap' };

	// The time part of stored dates (T00:00:00+05:30) is copied so the new candle looks the same.
	const suffix = last.date.slice(10) || 'T00:00:00+05:30';
	const provisional = isProvisionalQuote(q.date, now);

	if (gap === 'current') {
		// The quote's session is already stored: only a provisional candle of that same session is
		// worth replacing.
		if (lastDay !== q.date || !last.provisional) return { kind: 'unchanged' };
		const before = stored.at(-2);
		if (before && (jumped(before.close, q.open) || jumped(before.close, q.prevClose))) {
			return { kind: 'full', reason: 'corporate-action' };
		}
		return { kind: 'appended', candles: [...stored.slice(0, -1), quoteToCandle(q, suffix, provisional)] };
	}

	// Append: the quote's session is the one after the last stored candle.
	if (jumped(last.close, q.open) || jumped(last.close, q.prevClose)) {
		return { kind: 'full', reason: 'corporate-action' };
	}
	// The quote's `close` is the previous session's official close: settle the last stored candle
	// with it (that candle may have been built from a live price).
	const settled: Candle = { ...last, close: q.prevClose > 0 ? q.prevClose : last.close };
	delete settled.provisional;
	const cutoff = new Date(`${q.date}T00:00:00Z`);
	cutoff.setUTCDate(cutoff.getUTCDate() - KEEP_DAYS);
	const keepFrom = ymd(cutoff);
	const kept = [...stored.slice(0, -1), settled].filter((c) => candleDay(c) >= keepFrom);
	return { kind: 'appended', candles: [...kept, quoteToCandle(q, suffix, provisional)] };
}

/** Splits a list into runs of at most `size`. */
export function chunk<T>(items: T[], size: number): T[][] {
	const out: T[][] = [];
	for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
	return out;
}
