import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { MAX_SECTIONS, validateSectionName } from '$lib/valuation/watchlistSections';
import { countSections, createSection } from '$lib/valuation/server/marketIntelStore';

export const POST: RequestHandler = async ({ request, locals }) => {
	const body = (await request.json().catch(() => null)) as { name?: unknown } | null;
	const name = validateSectionName(body?.name);
	if (!name.ok) error(400, name.message);
	const userId = locals.user!.id;
	if ((await countSections(userId)) >= MAX_SECTIONS) error(400, `You can have up to ${MAX_SECTIONS} sections.`);
	const id = await createSection(userId, name.value);
	if (id == null) error(409, `You already have a section called "${name.value}".`);
	return json({ id });
};
