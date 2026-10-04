import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { readBody } from '$lib/valuation/server/sectorApi';
import { verifySymbol } from '$lib/valuation/server/symbolVerify';

export const POST: RequestHandler = async ({ request }) => {
	const body = await readBody(request);
	if (typeof body.symbol !== 'string') error(400, 'Missing "symbol".');
	try {
		return json(await verifySymbol(body.symbol));
	} catch (e) {
		error(502, (e as Error).message);
	}
};
