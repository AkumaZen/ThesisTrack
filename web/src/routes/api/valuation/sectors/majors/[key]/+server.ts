import type { RequestHandler } from './$types';
import { handleEdit, readBody } from '$lib/server/sectorApi';
import { deleteMajor, renameMajor } from '$lib/server/sectorStore';

export const PATCH: RequestHandler = async ({ params, request }) => {
	const body = await readBody(request);
	return handleEdit(async () => {
		await renameMajor(params.key, body.label);
		return { ok: true };
	});
};

export const DELETE: RequestHandler = ({ params }) =>
	handleEdit(async () => {
		await deleteMajor(params.key);
		return { ok: true };
	});
