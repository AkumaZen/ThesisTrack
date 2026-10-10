import { json, error } from '@sveltejs/kit';
import { createCompanySchema, type TrackerCompany } from '$lib/valuation/masterTracker';
import { createTrackerCompany, listTrackerCompanies, TrackerConflict, resetMockTracker } from '$lib/valuation/server/masterTrackerStore';
import { isTrackerTestRequest } from '$lib/valuation/server/masterTrackerMock';
import { lookupTrackerIdentity, TrackerProviderError } from '$lib/valuation/server/masterTrackerProvider';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => json(await listTrackerCompanies());
export const POST: RequestHandler = async ({ request, locals }) => {
	const parsed = createCompanySchema.safeParse(await request.json());
	if (!parsed.success) error(400, 'Provide a company name, valid symbol and optional six-digit BSE code.');
	let identityWarning: string | undefined;
	if (!parsed.data.bseCode) {
		try { parsed.data.bseCode = (await lookupTrackerIdentity(parsed.data)).bseCode; }
		catch (e) { if (e instanceof TrackerProviderError) identityWarning = e.message; else throw e; }
	}
	const company: TrackerCompany = { ...parsed.data, version: 1, quarters: [], guidance: [], valuation: null, valuationHistory: [], updatedBy: locals.user!.username, updatedAt: Date.now() };
	try { await createTrackerCompany(company); } catch (e) { if (e instanceof TrackerConflict) error(409, 'This company is already in the tracker.'); throw e; }
	return json({ ...company, identityWarning }, { status: 201 });
};
export const DELETE: RequestHandler = async ({ url }) => { if (!isTrackerTestRequest(url)) error(404, 'Not found'); resetMockTracker(); return json({ ok: true }); };
