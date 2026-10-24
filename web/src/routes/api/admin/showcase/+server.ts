import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { readJson, requireAdmin } from '$lib/server/authApi';
import { listShowcaseSymbols, normalizeShowcaseSymbol, setShowcase, SHOWCASE_ALL } from '$lib/server/showcase';

/** The symbols guests may see, and whether every company is shown regardless. */
export const GET: RequestHandler = async ({ locals }) => {
	requireAdmin(locals);
	const rows = await listShowcaseSymbols();
	return json({ symbols: rows.filter((s) => s !== SHOWCASE_ALL), all: rows.includes(SHOWCASE_ALL) });
};

/** Body: { symbol, showcase } turns guest visibility for one listing symbol on or off;
 *  { all } shows every company to guests, or goes back to the chosen symbols. */
export const PUT: RequestHandler = async ({ request, locals }) => {
	const admin = requireAdmin(locals);
	const body = await readJson(request);
	if (typeof body.all === 'boolean') {
		await setShowcase(SHOWCASE_ALL, body.all, admin.id);
		return json({ all: body.all });
	}
	const symbol = typeof body.symbol === 'string' ? normalizeShowcaseSymbol(body.symbol) : '';
	if (!symbol || symbol === SHOWCASE_ALL) error(400, 'A symbol is required.');
	if (typeof body.showcase !== 'boolean') error(400, 'showcase must be true or false.');
	await setShowcase(symbol, body.showcase, admin.id);
	return json({ symbol, showcase: body.showcase });
};
