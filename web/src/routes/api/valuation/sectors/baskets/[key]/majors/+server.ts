import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { handleEdit, readBody } from '$lib/valuation/server/sectorApi';
import { setBasketMajors } from '$lib/valuation/server/sectorStore';

/** Sets exactly which major sectors this basket belongs to (move / share / unassign). */
export const PUT: RequestHandler = async ({ params, request }) => {
	const body = await readBody(request);
	const majorKeys = body.majorKeys;
	if (!Array.isArray(majorKeys) || !majorKeys.every((k) => typeof k === 'string')) {
		error(400, '"majorKeys" must be an array of sector keys.');
	}
	return handleEdit(async () => {
		await setBasketMajors(params.key, majorKeys as string[]);
		return { ok: true };
	});
};
