import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { readJson, requireAdmin } from '$lib/server/authApi';
import { listShowcaseSymbols, normalizeShowcaseSymbol, setShowcase } from '$lib/server/showcase';

/** The symbols guests may see. */
export const GET: RequestHandler = async ({ locals }) => {
	requireAdmin(locals);
	return json({ symbols: await listShowcaseSymbols() });
};

/** Body: { symbol, showcase }. Turns guest visibility for one listing symbol on or off. */
export const PUT: RequestHandler = async ({ request, locals }) => {
	const admin = requireAdmin(locals);
	const body = await readJson(request);
	const symbol = typeof body.symbol === 'string' ? normalizeShowcaseSymbol(body.symbol) : '';
	if (!symbol) error(400, 'A symbol is required.');
	if (typeof body.showcase !== 'boolean') error(400, 'showcase must be true or false.');
	await setShowcase(symbol, body.showcase, admin.id);
	return json({ symbol, showcase: body.showcase });
};
