import type { RequestHandler } from './$types';
import { handleEdit } from '$lib/server/sectorApi';
import { removeSymbolFromBasket } from '$lib/server/sectorStore';

export const DELETE: RequestHandler = ({ params }) =>
	handleEdit(async () => ({ symbols: await removeSymbolFromBasket(params.key, params.symbol) }));
