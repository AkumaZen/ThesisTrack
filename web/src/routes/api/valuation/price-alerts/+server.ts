import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { MAX_ACTIVE_PRICE_ALERTS, validatePriceAlert } from '$lib/valuation/alertRules';
import { addPriceRule, companyNameFor, countActivePriceRules, lastStoredCloses } from '$lib/valuation/server/marketIntelStore';

// Creates a price-level or percentage-move alert on any stock. A % move is measured from the latest
// stored price, so a stock with no stored price can only get a price-level alert.
export const POST: RequestHandler = async ({ request, locals }) => {
	const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
	const symbol = typeof body?.symbol === 'string' ? body.symbol.trim().toUpperCase() : '';
	const closes = await lastStoredCloses(/^[A-Z0-9&-]{1,20}$/.test(symbol) ? [symbol] : []);
	const checked = validatePriceAlert(body, closes.get(symbol) ?? null);
	if (!checked.ok) error(400, checked.message);
	const userId = locals.user!.id;
	if ((await countActivePriceRules(userId)) >= MAX_ACTIVE_PRICE_ALERTS) error(400, `You can have ${MAX_ACTIVE_PRICE_ALERTS} active alerts. Remove one first.`);
	const name = await companyNameFor(symbol, body?.name);
	if (!name) error(400, 'Pick a company from the list.');
	const id = await addPriceRule(userId, name, checked.value);
	return json({ id });
};
