import type { PageServerLoad } from './$types';
import { listTracked } from '$lib/valuation/server/announcementStore';
import { getOnlyImportant, listUpcomingMeetings, watchlistNseSymbols } from '$lib/valuation/server/intelStore';
import { groupMeetings, istDay } from '$lib/valuation/boardMeetings';
import { pushConfigured } from '$lib/server/webPush';

// The person's own tracked companies. Each company's announcements load on demand (the API
// refreshes them from NSE), so this page renders from the database alone.
export const load: PageServerLoad = async ({ locals, url }) => {
	const userId = locals.user!.id;
	const tracked = (await listTracked(userId)).map((t) => ({
		nseSymbol: t.nseSymbol,
		companyName: t.companyName
	}));
	const wanted = url.searchParams.get('symbol')?.toUpperCase() ?? '';

	// Results calendar: the person's tracked companies plus the shared watchlist.
	const now = new Date();
	const trackedSet = new Set(tracked.map((t) => t.nseSymbol));
	const symbols = [...new Set([...trackedSet, ...(await watchlistNseSymbols())])];
	const meetings = (await listUpcomingMeetings(symbols, istDay(now))).map((m) => ({
		nseSymbol: m.nseSymbol,
		companyName: m.companyName,
		meetingDate: m.meetingDate,
		purpose: m.purpose,
		isResults: m.isResults,
		tracked: trackedSet.has(m.nseSymbol)
	}));

	return {
		tracked,
		initial: tracked.some((t) => t.nseSymbol === wanted) ? wanted : (tracked[0]?.nseSymbol ?? null),
		pushConfigured: pushConfigured(),
		calendar: groupMeetings(meetings, now),
		onlyImportant: await getOnlyImportant(userId)
	};
};
