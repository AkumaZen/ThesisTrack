import { error, json } from '@sveltejs/kit';
import { createCompanySchema } from '$lib/valuation/masterTracker';
import { lookupTrackerIdentity, TrackerProviderError } from '$lib/valuation/server/masterTrackerProvider';
import type { RequestHandler } from './$types';
export const GET: RequestHandler = async ({ url }) => {
	const parsed = createCompanySchema.pick({ symbol: true, name: true }).safeParse({ symbol: url.searchParams.get('symbol'), name: url.searchParams.get('name') });
	if (!parsed.success) error(400, 'Select a listed company first.');
	try { return json(await lookupTrackerIdentity(parsed.data)); }
	catch (e) { if (e instanceof TrackerProviderError) return json({ symbol: parsed.data.symbol, nseSymbol: /^\d{6}$/.test(parsed.data.symbol) ? null : parsed.data.symbol, bseCode: null, warning: e.message }); throw e; }
};
