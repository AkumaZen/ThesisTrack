import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { istDay } from '$lib/valuation/boardMeetings';
import { dividendStats } from '$lib/valuation/corporateActions';
import { holdingTimeline } from '$lib/valuation/insiderTrades';
import { refreshCompanyFilings } from '$lib/valuation/server/marketIntelJob';
import { annualEps, companyHoldingFilings, lastStoredCloses, listCompanyActions } from '$lib/valuation/server/marketIntelStore';

// One company's corporate actions and dividend ratios, and its insider/SAST holding-change history,
// for the company page components. NSE is asked at most once a day per company; if it is slow or
// down, what is already stored is served with `stale` set.
export const GET: RequestHandler = async ({ params }) => {
	const symbol = params.symbol.toUpperCase();
	if (!/^[A-Z0-9&-]{1,20}$/.test(symbol) || /^\d+$/.test(symbol)) error(400, 'Only NSE-listed companies are supported.');
	const refreshed = await refreshCompanyFilings(symbol).catch((err) => ({ refreshed: false, error: err instanceof Error ? err.message : String(err) }));
	const today = istDay(new Date());
	const [actions, closes, eps, filings] = await Promise.all([
		listCompanyActions(symbol),
		lastStoredCloses([symbol]),
		annualEps(symbol),
		companyHoldingFilings(symbol)
	]);
	const price = closes.get(symbol) ?? null;
	return json({
		symbol,
		stale: refreshed.error != null,
		price,
		actions: actions.map((a) => ({ ...a, upcoming: a.exDate >= today })),
		dividends: dividendStats(actions, price, today, eps),
		holdings: holdingTimeline(filings.trades, filings.sast).slice(0, 60)
	});
};
