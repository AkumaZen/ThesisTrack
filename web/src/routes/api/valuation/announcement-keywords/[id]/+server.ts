import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { removeKeyword } from '$lib/valuation/server/marketIntelStore';

export const DELETE: RequestHandler = async ({ params, locals }) => {
	const id = Number(params.id);
	if (!Number.isInteger(id) || id <= 0) error(400, 'Unknown keyword.');
	await removeKeyword(locals.user!.id, id);
	return json({ ok: true });
};
