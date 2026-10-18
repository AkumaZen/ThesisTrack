import { createHash } from 'node:crypto';

// Pure helpers for the NSE announcement alerts: parsing the exchange's rows, the stable dedupe key,
// who should be told, and the push message. No network or database in here, so it is all unit-tested.

export interface ParsedAnnouncement {
	dedupeKey: string;
	nseSymbol: string;
	companyName: string;
	subject: string;
	details: string;
	announcedAt: Date;
	pdfUrl: string | null;
}

const MONTHS: Record<string, string> = {
	jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
	jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12'
};

/** NSE writes times in IST as "17-Oct-2026 11:17:01" (sometimes date only). */
export function parseNseTime(raw: unknown): Date | null {
	if (typeof raw !== 'string') return null;
	const m = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(raw.trim());
	const month = m ? MONTHS[m[2].toLowerCase()] : undefined;
	if (!m || !month) return null;
	const iso = `${m[3]}-${month}-${m[1].padStart(2, '0')}T${m[4] ?? '00'}:${m[5] ?? '00'}:${m[6] ?? '00'}+05:30`;
	const date = new Date(iso);
	return Number.isNaN(date.getTime()) ? null : date;
}

const text = (value: unknown) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '');

/** NSE's own sequence id when there is one, else a hash of what identifies the filing. */
export function dedupeKeyFor(symbol: string, announcedAt: string, pdfUrl: string, seqId: string): string {
	if (seqId) return `nse:${seqId}`;
	return 'h:' + createHash('sha1').update(`${symbol}|${announcedAt}|${pdfUrl}`).digest('hex').slice(0, 24);
}

/** Rows the exchange returned -> announcements. Rows without a symbol, subject or a readable time are dropped. */
export function parseNseAnnouncements(payload: unknown): ParsedAnnouncement[] {
	if (!Array.isArray(payload)) return [];
	const out: ParsedAnnouncement[] = [];
	for (const row of payload) {
		if (!row || typeof row !== 'object') continue;
		const r = row as Record<string, unknown>;
		const nseSymbol = text(r.symbol).toUpperCase();
		const announcedAt = parseNseTime(r.an_dt) ?? parseNseTime(r.exchdisstime);
		const details = text(r.attchmntText);
		const subject = text(r.desc) || details.slice(0, 120);
		if (!nseSymbol || !subject || !announcedAt) continue;
		const pdf = text(r.attchmntFile);
		out.push({
			dedupeKey: dedupeKeyFor(nseSymbol, text(r.an_dt), pdf, text(r.seq_id)),
			nseSymbol,
			companyName: text(r.sm_name) || nseSymbol,
			subject,
			details,
			announcedAt,
			pdfUrl: /^https?:\/\//i.test(pdf) ? pdf : null
		});
	}
	return out;
}

/** Only filings published after the person started tracking are pushed (never the old history),
 *  and nothing older than `maxAgeMs` (a missed day should not turn into a flood). */
export function shouldNotify(
	announcedAt: Date,
	trackedSince: Date,
	now: Date,
	maxAgeMs = 24 * 3600_000
): boolean {
	return announcedAt > trackedSince && now.getTime() - announcedAt.getTime() <= maxAgeMs;
}

/** An announcement can be pushed once it has its summary, or once summarising has been given up on. */
export const MAX_SUMMARY_ATTEMPTS = 3;
export function readyToNotify(a: { summary: string | null; summaryAttempts: number }, summariesEnabled: boolean): boolean {
	return !summariesEnabled || !!a.summary || a.summaryAttempts >= MAX_SUMMARY_ATTEMPTS;
}

export interface PushPayload {
	title: string;
	body: string;
	url: string;
	tag: string;
}

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '\u2026' : s);

export function buildPushPayload(a: {
	id: number;
	nseSymbol: string;
	subject: string;
	summary: string | null;
	pdfUrl: string | null;
}): PushPayload {
	return {
		title: clip(`${a.nseSymbol}: ${a.subject}`, 100),
		body: clip(a.summary || a.subject, 280),
		// The tracking page shows the summary and the PDF link; it is the safer place to land.
		url: `/valuation/tracking?symbol=${encodeURIComponent(a.nseSymbol)}`,
		tag: `announcement-${a.id}`
	};
}
