import { istDay, meetingsFromAnnouncements, type ParsedMeeting } from '../boardMeetings';
import { fetchBoardMeetings } from './nseBoardMeetings';
import {
	calendarSymbols,
	claimDueSymbols,
	listRecentIntimations,
	markRefreshFailed,
	saveMeetings,
	tagUntagged
} from './intelStore';

// Slow, best-effort work that rides on the one-minute announcement poller. Each source has its own
// refresh interval kept in the database (symbol_refresh), and a per-run cap, so one poll stays well
// under the function timeout and a failing source never stops the announcement alerts.

const HOUR_MS = 3600_000;
export const BOARD_INTERVAL_MS = 6 * HOUR_MS;
const BOARD_PER_RUN = 12;
const CONCURRENCY = 4;
const INTIMATION_PARSE_INTERVAL_MS = HOUR_MS;
const INTIMATION_LOOKBACK_DAYS = 45;

export interface IntelSummary {
	tagged: number;
	calendarSymbols: number;
	meetingsStored: number;
	errors: string[];
}

export const emptyIntelSummary = (): IntelSummary => ({ tagged: 0, calendarSymbols: 0, meetingsStored: 0, errors: [] });

export interface CalendarDeps {
	fetchMeetings: (symbol: string, now: Date) => Promise<ParsedMeeting[]>;
}

export const defaultCalendarDeps: CalendarDeps = { fetchMeetings: (symbol, now) => fetchBoardMeetings(symbol, now) };

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Tracked and watchlist companies' upcoming board meetings, at most every 6 hours per company. */
export async function refreshCalendar(deps: CalendarDeps, now: Date, summary: IntelSummary) {
	const symbols = await calendarSymbols();
	const due = await claimDueSymbols('board', symbols, now, BOARD_INTERVAL_MS, BOARD_PER_RUN);
	summary.calendarSymbols = due.length;
	for (let i = 0; i < due.length; i += CONCURRENCY) {
		await Promise.all(
			due.slice(i, i + CONCURRENCY).map(async (symbol) => {
				try {
					const meetings = await deps.fetchMeetings(symbol, now);
					await saveMeetings(meetings);
					summary.meetingsStored += meetings.length;
				} catch (err) {
					await markRefreshFailed('board', symbol).catch(() => {});
					summary.errors.push(`board ${symbol}: ${message(err)}`);
				}
			})
		);
	}

	// Meeting dates written inside intimations we already hold (hourly, one cheap query).
	const [claimed] = await claimDueSymbols('intimation-text', ['*'], now, INTIMATION_PARSE_INTERVAL_MS, 1);
	if (claimed) {
		const since = new Date(now.getTime() - INTIMATION_LOOKBACK_DAYS * 24 * HOUR_MS);
		const parsed = meetingsFromAnnouncements(await listRecentIntimations(symbols, since), istDay(now));
		await saveMeetings(parsed);
		summary.meetingsStored += parsed.length;
	}
}

/** Tags announcements stored before tagging existed (a few hundred per run until none are left). */
export async function tagBacklog(summary: IntelSummary) {
	summary.tagged = await tagUntagged();
}
