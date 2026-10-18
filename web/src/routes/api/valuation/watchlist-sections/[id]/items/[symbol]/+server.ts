import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { validateFlag } from '$lib/valuation/watchlistSections';
import { ownsSection, removeSectionItem, setSectionFlag } from '$lib/valuation/server/marketIntelStore';

async function guard(params: { id: string }, userId: number): Promise<number> {
	const sectionId = Number(params.id);
	if (!Number.isInteger(sectionId) || !(await ownsSection(userId, sectionId))) error(404, 'Unknown section.');
	return sectionId;
}

// Sets or clears the flag (colour and short label) on a company in a section.
export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	const sectionId = await guard(params, locals.user!.id);
	const flag = validateFlag(await request.json().catch(() => null));
	if (!flag.ok) error(400, flag.message);
	await setSectionFlag(sectionId, params.symbol.toUpperCase(), flag.value);
	return json({ ok: true });
};

export const DELETE: RequestHandler = async ({ params, locals }) => {
	const sectionId = await guard(params, locals.user!.id);
	await removeSectionItem(sectionId, params.symbol.toUpperCase());
	return json({ ok: true });
};
