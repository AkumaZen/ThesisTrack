import type { RequestHandler } from './$types';
import { handleEdit, readBody } from '$lib/valuation/server/sectorApi';
import { createMajor } from '$lib/valuation/server/sectorStore';

export const POST: RequestHandler = async ({ request }) => {
	const body = await readBody(request);
	return handleEdit(() => createMajor(body.label));
};
