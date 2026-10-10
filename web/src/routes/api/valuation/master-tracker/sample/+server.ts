import { error, json } from '@sveltejs/kit';
import { acceptPreview, type Preview, type TrackerCompany } from '$lib/valuation/masterTracker';
import { mockCompanies, mockQuarters, isTrackerTestRequest } from '$lib/valuation/server/masterTrackerMock';
import { supremePowerSample } from '$lib/valuation/server/masterTrackerSample';
import { createTrackerCompany, getTrackerCompany, updateTrackerCompany } from '$lib/valuation/server/masterTrackerStore';
import type { RequestHandler } from './$types';

// A seed for the requested local review; unavailable in production or normal development.
export const POST: RequestHandler = async ({ url, locals }) => {
	if (!isTrackerTestRequest(url)) error(404, 'Not found');
	const identity = mockCompanies[0];
	let company = await getTrackerCompany(identity.symbol);
	if (!company) {
		company = { ...identity, version: 1, quarters: mockQuarters, guidance: [], valuation: null, valuationHistory: [], updatedBy: locals.user!.username, updatedAt: Date.now() } satisfies TrackerCompany;
		await createTrackerCompany(company);
	}
	const analysis = supremePowerSample(company);
	if (!analysis.guidance.length && !analysis.valuation) return json({ ok: true, symbol: company.symbol, added: 0 });
	const preview: Preview = { id: crypto.randomUUID(), symbol: company.symbol, userId: locals.user!.id, baseVersion: company.version, quarters: mockQuarters.map((q) => q.id), analysis, createdAt: Date.now() };
	const next = acceptPreview({ ...company, quarters: mockQuarters, sector: company.sector || identity.sector, subsector: company.subsector || identity.subsector, bseCode: company.bseCode ?? identity.bseCode }, preview, analysis.guidance.map((g) => g.id), !!analysis.valuation, locals.user!.username);
	await updateTrackerCompany(next, company.version);
	return json({ ok: true, symbol: company.symbol, added: analysis.guidance.length, fictional: true });
};
