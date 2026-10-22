import { istDay } from '$lib/valuation/boardMeetings';
import { PROMPT_VERSION } from '$lib/valuation/concall/analysis';
import { buildConcallRows } from '$lib/valuation/concall/rows';
import { aiEnabled } from '$lib/valuation/server/aiSwitch';
import * as store from '$lib/valuation/server/concallStore';
import type { PageServerLoad } from './$types';

// Stored data only: the page never fetches Screener or calls a model. "Refresh" and "Analyse" are explicit actions.
export const load: PageServerLoad = async ({ locals }) => {
	const [companies, scans, analyses, watchlists] = await Promise.all([store.listCompanies(), store.listScans(), store.listAnalyses(), store.listWatchlistOptions(locals.user!.id)]);
	const current = analyses.filter((a) => a.promptVersion === PROMPT_VERSION);
	const upcoming = await store.upcomingCalls(companies.map((c) => c.symbol), istDay(new Date()));
	const { rows, unscanned } = buildConcallRows(companies, scans, current, upcoming);
	const analysed = new Set(current.map((a) => a.transcriptHash));
	return {
		aiEnabled: aiEnabled(),
		rows,
		unscanned,
		companyCount: companies.length,
		sectors: [...new Set(companies.map((c) => c.sector).filter(Boolean))].sort(),
		watchlists: watchlists.filter((w) => w.symbols.length),
		pending: scans.reduce((n, s) => n + s.transcripts.filter((t) => !analysed.has(t.hash)).length, 0)
	};
};
