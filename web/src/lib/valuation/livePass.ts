// Pure rules for "live, provisional" market breadth: which symbols one background pass covers,
// whether a stored breadth day is still provisional, and how its time is written for people.
import { istClock } from './server/refreshMerge';

/** Breadth for a session stays provisional until this IST time (same as a provisional candle). */
const SETTLED_AT_IST_MINUTES = 16 * 60;

/** The symbols one intraday pass covers: the sector/scanner symbols and the whole-market breadth
 *  list, upper-cased, de-duplicated and sorted (the pass cursor relies on the order). */
export function passUniverse(...lists: string[][]): string[] {
	const all = new Set<string>();
	for (const list of lists) for (const s of list) if (s?.trim()) all.add(s.trim().toUpperCase());
	return [...all].sort();
}

/** Whether the breadth stored for `asOf` was computed before that session was final: the session
 *  is a weekday and its figures were computed on the same IST day before 16:00. Derived from the
 *  stored computed-at time alone, so no extra flag is stored: the settle pass and the nightly job
 *  recompute after 16:00 and the day stops being provisional by itself. */
export function isProvisionalBreadth(asOf: string, computedAt: Date | string | null): boolean {
	if (!computedAt) return false;
	const at = new Date(computedAt);
	if (Number.isNaN(at.getTime())) return false;
	const weekday = new Date(`${asOf}T00:00:00Z`).getUTCDay();
	if (weekday === 0 || weekday === 6) return false;
	const ist = istClock(at);
	return ist.day === asOf && ist.minutes < SETTLED_AT_IST_MINUTES;
}

/** "Tue, 27 Oct 2026, 1:30 pm" in IST; the caller adds the zone name. */
export function formatIst(at: Date | string): string {
	return new Intl.DateTimeFormat('en-GB', {
		timeZone: 'Asia/Kolkata',
		weekday: 'short',
		day: 'numeric',
		month: 'short',
		year: 'numeric',
		hour: 'numeric',
		minute: '2-digit',
		hour12: true
	}).format(new Date(at));
}
