import { parseNseTime } from './nseTime';

// Pure helpers for the results calendar: reading NSE's board-meeting rows, finding a meeting date
// inside an announcement's text, the dedupe key, the "This week / Later" grouping and the throttle
// that decides which symbols are due for a refresh. No network or database in here.

export interface ParsedMeeting {
	dedupeKey: string;
	nseSymbol: string;
	companyName: string;
	/** Calendar day in IST, YYYY-MM-DD. */
	meetingDate: string;
	purpose: string;
	isResults: boolean;
	source: 'nse' | 'announcement';
}

const IST_MS = 5.5 * 3600_000;

/** YYYY-MM-DD of the IST calendar day containing the instant. */
export const istDay = (d: Date): string => new Date(d.getTime() + IST_MS).toISOString().slice(0, 10);

const addDays = (day: string, n: number): string => {
	const d = new Date(`${day}T00:00:00Z`);
	d.setUTCDate(d.getUTCDate() + n);
	return d.toISOString().slice(0, 10);
};

const RESULTS_RE = /financial results?|\bresults?\b|\bunaudited\b|\baudited\b/i;
export const mentionsResults = (text: string): boolean => RESULTS_RE.test(text);

/** One meeting per company, day and kind: NSE sends several rows for one meeting (the intimation,
 *  then one per agenda item) and the announcement text says it a third time. */
export const meetingKey = (symbol: string, day: string, isResults: boolean) =>
	`${symbol}|${day}|${isResults ? 'results' : 'other'}`;

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s);

/** Rows from nseindia.com/api/corporate-board-meetings that fall on or after `today` (IST day). */
export function parseNseBoardMeetings(payload: unknown, today: string): ParsedMeeting[] {
	if (!Array.isArray(payload)) return [];
	const byKey = new Map<string, ParsedMeeting>();
	for (const row of payload) {
		if (!row || typeof row !== 'object') continue;
		const r = row as Record<string, unknown>;
		const symbol = typeof r.bm_symbol === 'string' ? r.bm_symbol.trim().toUpperCase() : '';
		const when = parseNseTime(r.bm_date);
		if (!symbol || !when) continue;
		const day = istDay(when);
		if (day < today) continue;
		const purposeText = typeof r.bm_purpose === 'string' ? r.bm_purpose.replace(/\s+/g, ' ').trim() : '';
		const desc = typeof r.bm_desc === 'string' ? r.bm_desc.replace(/\s+/g, ' ').trim() : '';
		const isResults = mentionsResults(`${purposeText} ${desc}`);
		const key = meetingKey(symbol, day, isResults);
		const existing = byKey.get(key);
		// The agenda row ("Financial Results") is shorter and clearer than the intimation row.
		const purpose = isResults ? 'Financial results' : clip(purposeText || desc || 'Board meeting', 120);
		if (existing && existing.purpose !== 'Board Meeting Intimation') continue;
		byKey.set(key, {
			dedupeKey: key,
			nseSymbol: symbol,
			companyName: typeof r.sm_name === 'string' && r.sm_name.trim() ? r.sm_name.trim() : symbol,
			meetingDate: day,
			purpose,
			isResults,
			source: 'nse'
		});
	}
	return [...byKey.values()];
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const monthNo = (name: string): number => MONTHS.indexOf(name.slice(0, 3).toLowerCase()) + 1;
const MONTH_RE = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';

const iso = (y: number, m: number, d: number): string | null => {
	if (m < 1 || m > 12 || d < 1 || d > 31 || y < 2000 || y > 2100) return null;
	const t = new Date(Date.UTC(y, m - 1, d));
	return t.getUTCMonth() === m - 1 ? t.toISOString().slice(0, 10) : null; // rejects 31 Feb
};

/** Every calendar date written in the text, in reading order, as YYYY-MM-DD. Handles
 *  "19-Oct-2026", "19th October, 2026", "October 19, 2026" and "19/10/2026" (day first, as in India). */
export function findDates(text: string): string[] {
	const found: { at: number; day: string }[] = [];
	const patterns: [RegExp, (m: RegExpExecArray) => string | null][] = [
		[new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?[\\s\\-]+(?:of\\s+)?${MONTH_RE}[\\s\\-,.]+(\\d{4})\\b`, 'gi'), (m) => iso(+m[3], monthNo(m[2]), +m[1])],
		[new RegExp(`\\b${MONTH_RE}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})\\b`, 'gi'), (m) => iso(+m[3], monthNo(m[1]), +m[2])],
		[/\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})\b/g, (m) => iso(+m[3], +m[2], +m[1])]
	];
	for (const [re, make] of patterns) {
		for (let m = re.exec(text); m; m = re.exec(text)) {
			const day = make(m);
			if (day) found.push({ at: m.index, day });
		}
	}
	return found.sort((a, b) => a.at - b.at).map((f) => f.day);
}

/** The meeting day an intimation announces: the first date in the text that is not before the day it
 *  was published and is within four months (so "dated 3 March 2026" boilerplate is ignored). */
export function parseMeetingDate(text: string, announcedAt: Date): string | null {
	const from = istDay(announcedAt);
	const limit = addDays(from, 120);
	return findDates(text).find((d) => d >= from && d <= limit) ?? null;
}

// ---- calendar grouping ----

export interface CalendarEntry {
	nseSymbol: string;
	companyName: string;
	meetingDate: string;
	purpose: string;
	isResults: boolean;
}

/** Sunday (IST) that ends the week containing `today`. Monday-first weeks. */
export function endOfWeek(today: string): string {
	const dow = new Date(`${today}T00:00:00Z`).getUTCDay(); // 0 = Sunday
	return addDays(today, dow === 0 ? 0 : 7 - dow);
}

/** Upcoming meetings split into this week (today to Sunday) and later, each sorted by date. Past days are dropped. */
export function groupMeetings<T extends { meetingDate: string }>(
	meetings: T[],
	now: Date
): { thisWeek: T[]; later: T[] } {
	const today = istDay(now);
	const end = endOfWeek(today);
	const upcoming = meetings.filter((m) => m.meetingDate >= today).sort((a, b) => a.meetingDate.localeCompare(b.meetingDate));
	return {
		thisWeek: upcoming.filter((m) => m.meetingDate <= end),
		later: upcoming.filter((m) => m.meetingDate > end)
	};
}

/** "Mon, 19 Oct 2026" for a YYYY-MM-DD day (a calendar date, so no time zone shifting). */
export function formatMeetingDay(day: string): string {
	const d = new Date(`${day}T00:00:00Z`);
	const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getUTCDay()];
	const month = MONTHS[d.getUTCMonth()];
	return `${weekday}, ${String(d.getUTCDate()).padStart(2, '0')} ${month[0].toUpperCase()}${month.slice(1)} ${d.getUTCFullYear()}`;
}

// ---- throttle ----

export interface RefreshState {
	refreshedAt: Date;
	ok: boolean;
}

/** A source is due when it has never been refreshed, when a good refresh is older than `intervalMs`,
 *  or when a failed one is older than `retryMs` (so one NSE hiccup does not hide a company for hours). */
export function isDue(state: RefreshState | undefined, now: Date, intervalMs: number, retryMs = 15 * 60_000): boolean {
	if (!state) return true;
	const age = now.getTime() - state.refreshedAt.getTime();
	return age >= (state.ok ? intervalMs : retryMs);
}

/** Meetings read from the text of board-meeting intimations we already stored (a second source next to
 *  NSE's own list, for companies whose row has not reached it yet). */
export function meetingsFromAnnouncements(
	rows: { nseSymbol: string; companyName: string; subject: string; details: string; announcedAt: Date }[],
	today: string
): ParsedMeeting[] {
	const out: ParsedMeeting[] = [];
	for (const r of rows) {
		const text = `${r.subject} ${r.details}`;
		const day = parseMeetingDate(text, r.announcedAt);
		if (!day || day < today) continue;
		const isResults = mentionsResults(text);
		out.push({
			dedupeKey: meetingKey(r.nseSymbol, day, isResults),
			nseSymbol: r.nseSymbol,
			companyName: r.companyName,
			meetingDate: day,
			purpose: isResults ? 'Financial results' : 'Board meeting',
			isResults,
			source: 'announcement'
		});
	}
	return out;
}
