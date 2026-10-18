import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { isTracked, listAnnouncements, removeTracked, saveAnnouncements } from '$lib/valuation/server/announcementStore';
import { fetchSymbolAnnouncements } from '$lib/valuation/server/nseAnnouncements';

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
	return json({ announcements: await listAnnouncements(symbol), stale });
};

export const DELETE: RequestHandler = async ({ params, locals }) => {
	await removeTracked(locals.user!.id, params.symbol.toUpperCase());
	return json({ ok: true });
};
