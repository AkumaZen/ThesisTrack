import type { RequestHandler } from './$types';
import { handleEdit, readBody, requireVerified } from '$lib/server/sectorApi';
import { createBasket } from '$lib/server/sectorStore';

/** Creates a basket seeded with one verified company, attached to `majorKey` (optional). */
export const POST: RequestHandler = async ({ request }) => {
	const body = await readBody(request);
	return handleEdit(async () => {
		const verified = await requireVerified(body.symbol);
		const majorKey = typeof body.majorKey === 'string' && body.majorKey ? body.majorKey : null;
		return createBasket(body.label, majorKey, [verified.symbol]);
	});
};
