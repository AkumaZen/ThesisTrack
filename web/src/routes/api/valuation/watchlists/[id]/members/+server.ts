import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { setMembership } from '$lib/valuation/server/watchlistsStore';

const SYMBOL = /^[A-Z0-9&.-]{1,20}$/;

/** Body: { symbol, member: true | false } - puts a company on, or takes it off, the list. */
export const PUT: RequestHandler = async ({ params, request, locals }) => {
	const id = Number(params.id);
	if (!Number.isInteger(id) || id <= 0) error(400, 'Invalid list id');
	const body = (await request.json().catch(() => null)) as {
		symbol?: unknown;
		member?: unknown;
	} | null;
	const symbol = typeof body?.symbol === 'string' ? body.symbol.trim().toUpperCase() : '';
	if (!SYMBOL.test(symbol)) error(400, '"symbol" must be an NSE ticker.');
	if (typeof body?.member !== 'boolean') error(400, '"member" must be true or false.');
	const result = await setMembership(id, symbol, body.member, locals.user!.username);
	if (!result.ok) error(404, 'That list no longer exists.');
	return json({ ok: true });
};
