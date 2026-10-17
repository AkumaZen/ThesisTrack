// Preview for the create form: the stored market close the buy price would be filled from.
// Reads stored prices only (see services/entryPrice.ts).
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { errorResponse, handleAuthError, requireActor } from '$lib/server/http';
import { lookupStored, todayIst, validateEntryDate } from '$lib/server/services/entryPrice';

export const GET: RequestHandler = async ({ locals, url }) => {
	try {
		requireActor(locals.actor);
		const nse = url.searchParams.get('nse_ticker')?.trim() || null;
		const bse = url.searchParams.get('bse_ticker')?.trim() || null;
		const date = url.searchParams.get('date') || todayIst();
		const bad = validateEntryDate(date);
		if (bad) return errorResponse(422, bad);
		const look = await lookupStored({ nseTicker: nse, bseTicker: bse }, date);
		// stored = a close exists; no_source = Angel One has no listing, so there will never be one;
		// none = listed (or unknown) but nothing stored yet, so the price must be typed.
		const status = look.stored ? 'stored' : look.listed === false ? 'no_source' : 'none';
		return json({ symbol: look.symbol, requested_date: date, status, close: look.stored });
	} catch (err) {
		return handleAuthError(err);
	}
};
