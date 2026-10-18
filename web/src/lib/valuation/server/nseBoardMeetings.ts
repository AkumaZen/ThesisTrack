import { parseNseBoardMeetings, istDay, type ParsedMeeting } from '../boardMeetings';
import { fetchNseJson } from './nseAnnouncements';

/** Upcoming board meetings one company has told NSE about (past meetings are dropped). */
export async function fetchBoardMeetings(
	symbol: string,
	now: Date = new Date(),
	fetcher: typeof fetch = fetch
): Promise<ParsedMeeting[]> {
	const payload = await fetchNseJson(`corporate-board-meetings?index=equities&symbol=${encodeURIComponent(symbol)}`, fetcher);
	return parseNseBoardMeetings(payload, istDay(now));
}
