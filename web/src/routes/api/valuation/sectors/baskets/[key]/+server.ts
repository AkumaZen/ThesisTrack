import type { RequestHandler } from './$types';
import { handleEdit, readBody } from '$lib/valuation/server/sectorApi';
import { deleteBasket, renameBasket } from '$lib/valuation/server/sectorStore';

export const PATCH: RequestHandler = async ({ params, request }) => {
	const body = await readBody(request);
	return handleEdit(async () => {
		await renameBasket(params.key, body.label);
		return { ok: true };
	});
};

export const DELETE: RequestHandler = ({ params }) =>
	handleEdit(async () => {
		await deleteBasket(params.key);
		return { ok: true };
	});
