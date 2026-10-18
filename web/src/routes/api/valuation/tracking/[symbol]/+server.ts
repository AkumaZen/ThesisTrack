import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { isTracked, listAnnouncements, removeTracked, saveAnnouncements } from '$lib/valuation/server/announcementStore';
import { fetchSymbolAnnouncements } from '$lib/valuation/server/nseAnnouncements';
import { getShareholding, listDeals } from '$lib/valuation/server/intelStore';
import { holdingChange } from '$lib/valuation/deals';
import { istDay } from '$lib/valuation/boardMeetings';

// Opening a tracked company pulls its recent filings from NSE (cached into the table), then lists them.
export const GET: RequestHandler = async ({ params, locals }) => {
	const symbol = params.symbol.toUpperCase();
	if (!(await isTracked(locals.user!.id, symbol))) error(404, 'You are not tracking this company.');
	let stale = false;
	try {
		await saveAnnouncements(await fetchSymbolAnnouncements(symbol, 90));
	} catch {
		stale = true; // NSE slow or down: what is already stored still shows
	}
	const now = new Date();
	const [list, deals, holding] = await Promise.all([
		listAnnouncements(symbol),
		listDeals(symbol, istDay(new Date(now.getTime() - 30 * 86_400_000))),
		getShareholding(symbol)
	]);
	return json({
		announcements: list,
		stale,
		deals: deals.map((d) => ({
			id: d.id,
			kind: d.kind,
			dealDate: d.dealDate,
			clientName: d.clientName,
			side: d.side,
			quantity: d.quantity,
			price: d.price
		})),
		shareholding: holding && {
			period: holding.period,
			prevPeriod: holding.prevPeriod,
			pledgedPct: holding.pledgedPct,
			rows: [
				{ label: 'Promoters', value: holding.promoters, change: holdingChange(holding.promoters, holding.prevPromoters) },
				{ label: 'FIIs', value: holding.fiis, change: holdingChange(holding.fiis, holding.prevFiis) },
				{ label: 'DIIs', value: holding.diis, change: holdingChange(holding.diis, holding.prevDiis) },
				{ label: 'Public', value: holding.public, change: holdingChange(holding.public, holding.prevPublic) }
			]
		}
	});
};

export const DELETE: RequestHandler = async ({ params, locals }) => {
	await removeTracked(locals.user!.id, params.symbol.toUpperCase());
	return json({ ok: true });
};
