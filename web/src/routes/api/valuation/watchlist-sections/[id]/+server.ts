import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { validateSectionName } from '$lib/valuation/watchlistSections';
import { deleteSection, renameSection } from '$lib/valuation/server/marketIntelStore';

const idOf = (raw: string) => {
	const id = Number(raw);
	if (!Number.isInteger(id) || id <= 0) error(404, 'Unknown section.');
	return id;
};

export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	const body = (await request.json().catch(() => null)) as { name?: unknown } | null;
	const name = validateSectionName(body?.name);
	if (!name.ok) error(400, name.message);
	if (!(await renameSection(locals.user!.id, idOf(params.id), name.value))) error(409, 'That section does not exist or the name is already used.');
	return json({ ok: true });
};

export const DELETE: RequestHandler = async ({ params, locals }) => {
	await deleteSection(locals.user!.id, idOf(params.id));
	return json({ ok: true });
};
