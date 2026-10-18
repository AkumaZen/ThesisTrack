import type { PageServerLoad } from './$types';
import { istDay } from '$lib/valuation/boardMeetings';
import { listTracked } from '$lib/valuation/server/announcementStore';
import { listUpcomingMeetings } from '$lib/valuation/server/intelStore';
import { listSections } from '$lib/valuation/server/marketIntelStore';

// The person's named sections of companies, each with its own results calendar (the board
// meetings stored for the results calendar on the tracked companies page).
export const load: PageServerLoad = async ({ locals }) => {
	const userId = locals.user!.id;
	const [sections, tracked] = await Promise.all([listSections(userId), listTracked(userId)]);
	const symbols = [...new Set(sections.flatMap((s) => s.items.map((i) => i.nseSymbol)))];
	const meetings = await listUpcomingMeetings(symbols, istDay(new Date()));
	return {
		tracked: tracked.map((t) => ({ nseSymbol: t.nseSymbol, companyName: t.companyName })),
		sections: sections.map((s) => {
			const own = new Set(s.items.map((i) => i.nseSymbol));
			return {
				...s,
				calendar: meetings
					.filter((m) => own.has(m.nseSymbol))
					.slice(0, 12)
					.map((m) => ({ nseSymbol: m.nseSymbol, companyName: m.companyName, meetingDate: m.meetingDate, purpose: m.purpose, isResults: m.isResults }))
			};
		})
	};
};
