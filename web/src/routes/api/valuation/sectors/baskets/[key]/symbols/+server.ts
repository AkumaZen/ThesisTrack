import type { RequestHandler } from './$types';
import { handleEdit, readBody, requireVerified } from '$lib/server/sectorApi';
import { addSymbolToBasket } from '$lib/server/sectorStore';

/** Adds a company to a basket - only after the server itself has verified the symbol. */
export const POST: RequestHandler = async ({ params, request }) => {
	const body = await readBody(request);
	return handleEdit(async () => {
		const verified = await requireVerified(body.symbol);
		const symbols = await addSymbolToBasket(params.key, verified.symbol);
		return { symbols, name: verified.name, listedOnAngelOne: verified.listedOnAngelOne };
	});
};
