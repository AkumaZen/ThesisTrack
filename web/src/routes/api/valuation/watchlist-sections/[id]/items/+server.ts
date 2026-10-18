import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { MAX_SECTION_ITEMS } from '$lib/valuation/watchlistSections';
import { addSectionItem, companyNameFor, countSectionItems, ownsSection } from '$lib/valuation/server/marketIntelStore';

// Puts a company into one of the person's sections.
export const POST: RequestHandler = async ({ params, request, locals }) => {
	const sectionId = Number(params.id);
	if (!Number.isInteger(sectionId) || !(await ownsSection(locals.user!.id, sectionId))) error(404, 'Unknown section.');
	const body = (await request.json().catch(() => null)) as { symbol?: unknown; name?: unknown } | null;
	const symbol = typeof body?.symbol === 'string' ? body.symbol.trim().toUpperCase() : '';
	if (!/^[A-Z0-9&-]{1,20}$/.test(symbol)) error(400, 'Pick a company from the list.');
	if ((await countSectionItems(sectionId)) >= MAX_SECTION_ITEMS) error(400, `A section holds up to ${MAX_SECTION_ITEMS} companies.`);
	const name = await companyNameFor(symbol, body?.name);
	if (!name) error(400, 'Pick a company from the list.');
	await addSectionItem(sectionId, symbol, name);
	return json({ ok: true, symbol, name });
};
