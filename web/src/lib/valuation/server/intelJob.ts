import { istDay, meetingsFromAnnouncements, type ParsedMeeting } from '../boardMeetings';
import { fetchBoardMeetings } from './nseBoardMeetings';
import { fetchLatestDeals } from './nseDeals';
import { fetchShareholding, type ShareholdingParsed } from './shareholding';
import type { ParsedDeal } from '../deals';
import { distinctTrackedSymbols } from './announcementStore';
import {
	calendarSymbols,
	claimDueSymbols,
	listRecentIntimations,
	markRefreshFailed,
	saveDeals,
	saveMeetings,
	saveShareholding,
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
/** The deals snapshot is the latest trading day only and appears after the close, so poll it a few times a day. */
export const DEALS_INTERVAL_MS = 3 * HOUR_MS;
/** Shareholding changes quarterly; a daily look is plenty. */
export const SHAREHOLDING_INTERVAL_MS = 24 * HOUR_MS;
const SHAREHOLDING_PER_RUN = 4;

export interface IntelSummary {
	tagged: number;
	calendarSymbols: number;
	meetingsStored: number;
	newDeals: number;
	shareholdingUpdated: number;
	errors: string[];
}

export const emptyIntelSummary = (): IntelSummary => ({ tagged: 0, calendarSymbols: 0, meetingsStored: 0, newDeals: 0, shareholdingUpdated: 0, errors: [] });

export interface IntelDeps {
	fetchMeetings: (symbol: string, now: Date) => Promise<ParsedMeeting[]>;
	fetchDeals: () => Promise<ParsedDeal[]>;
	fetchShareholding: (symbol: string) => Promise<ShareholdingParsed | null>;
}

export const defaultIntelDeps: IntelDeps = {
	fetchMeetings: (symbol, now) => fetchBoardMeetings(symbol, now),
	fetchDeals: () => fetchLatestDeals(),
	fetchShareholding: (symbol) => fetchShareholding(symbol)
};

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Tracked and watchlist companies' upcoming board meetings, at most every 6 hours per company. */
export async function refreshCalendar(deps: Pick<IntelDeps, 'fetchMeetings'>, now: Date, summary: IntelSummary) {
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

/** Bulk and block deals of watched companies: one snapshot request every few hours. */
export async function refreshDeals(deps: Pick<IntelDeps, 'fetchDeals'>, now: Date, summary: IntelSummary) {
	const [claimed] = await claimDueSymbols('deals', ['*'], now, DEALS_INTERVAL_MS, 1);
	if (!claimed) return;
	try {
		summary.newDeals = await saveDeals(await deps.fetchDeals(), await calendarSymbols());
	} catch (err) {
		await markRefreshFailed('deals', '*').catch(() => {});
		summary.errors.push(`deals: ${message(err)}`);
	}
}

/** Latest shareholding pattern of tracked companies, each at most once a day. */
export async function refreshShareholding(deps: Pick<IntelDeps, 'fetchShareholding'>, now: Date, summary: IntelSummary) {
	const due = await claimDueSymbols('shareholding', await distinctTrackedSymbols(), now, SHAREHOLDING_INTERVAL_MS, SHAREHOLDING_PER_RUN);
	for (const symbol of due) {
		try {
			const parsed = await deps.fetchShareholding(symbol);
			if (!parsed) throw new Error('no shareholding table');
			await saveShareholding(symbol, parsed);
			summary.shareholdingUpdated++;
		} catch (err) {
			await markRefreshFailed('shareholding', symbol).catch(() => {});
			summary.errors.push(`shareholding ${symbol}: ${message(err)}`);
		}
	}
}

/** Tags announcements stored before tagging existed (a few hundred per run until none are left). */
export async function tagBacklog(summary: IntelSummary) {
	summary.tagged = await tagUntagged();
}
