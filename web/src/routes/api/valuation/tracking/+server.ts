import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { addTracked, saveAnnouncements } from '$lib/valuation/server/announcementStore';
import { fetchSymbolAnnouncements } from '$lib/valuation/server/nseAnnouncements';

const HISTORY_DAYS = 90;

// Track a company: the symbol must have announcements on NSE (that is how a BSE-only or unknown
// company is told apart), and the response carries NSE's own company name.
export const POST: RequestHandler = async ({ request, locals }) => {
	const body = (await request.json().catch(() => null)) as { symbol?: unknown } | null;
	const symbol = typeof body?.symbol === 'string' ? body.symbol.trim().toUpperCase() : '';
	if (!/^[A-Z0-9&-]{1,20}$/.test(symbol)) error(400, 'Pick a company from the list.');
	if (/^\d+$/.test(symbol)) {
		error(400, `${symbol} is a BSE code. Announcement alerts need an NSE-listed company.`);
	}
	let rows;
	try {
		rows = await fetchSymbolAnnouncements(symbol, HISTORY_DAYS);
	} catch {
		error(502, 'Could not reach NSE to check this company. Try again in a moment.');
	}
	if (!rows.length) {
		error(400, `NSE has no announcements for ${symbol} in the last ${HISTORY_DAYS} days, so it cannot be tracked. Only NSE-listed companies are supported.`);
	}
	const companyName = rows[0].companyName;
	await addTracked(locals.user!.id, symbol, companyName);
	await saveAnnouncements(rows);
	return json({ nseSymbol: symbol, companyName });
};
