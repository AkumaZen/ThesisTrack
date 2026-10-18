import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { MAX_ACTIVE_PRICE_ALERTS } from '$lib/valuation/alertRules';
import { countActivePriceRules, lastStoredCloses, listPriceRules, rearmPriceRule, removePriceRule } from '$lib/valuation/server/marketIntelStore';

const idOf = (raw: string) => {
	const id = Number(raw);
	if (!Number.isInteger(id) || id <= 0) error(400, 'Unknown alert.');
	return id;
};

export const DELETE: RequestHandler = async ({ params, locals }) => {
	await removePriceRule(locals.user!.id, idOf(params.id));
	return json({ ok: true });
};

// Turns an alert that has fired back on; a % move restarts from the latest stored price.
export const PATCH: RequestHandler = async ({ params, locals }) => {
	const userId = locals.user!.id;
	const id = idOf(params.id);
	const rule = (await listPriceRules(userId)).find((r) => r.id === id);
	if (!rule) error(404, 'Unknown alert.');
	if (!rule.active && (await countActivePriceRules(userId)) >= MAX_ACTIVE_PRICE_ALERTS) error(400, `You can have ${MAX_ACTIVE_PRICE_ALERTS} active alerts. Remove one first.`);
	const price = (await lastStoredCloses([rule.nseSymbol])).get(rule.nseSymbol) ?? null;
	await rearmPriceRule(userId, id, price);
	return json({ ok: true });
};
