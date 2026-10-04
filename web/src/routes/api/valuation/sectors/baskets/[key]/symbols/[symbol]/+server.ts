import type { RequestHandler } from './$types';
import { handleEdit } from '$lib/valuation/server/sectorApi';
import { removeSymbolFromBasket } from '$lib/valuation/server/sectorStore';

export const DELETE: RequestHandler = ({ params }) =>
	handleEdit(async () => ({ symbols: await removeSymbolFromBasket(params.key, params.symbol) }));
