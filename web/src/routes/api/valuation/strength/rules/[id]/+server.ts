import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { deleteRule, setRuleEnabled } from '$lib/valuation/server/strengthRulesStore';

const idOf = (raw: string | undefined) => {
	const id = Number(raw);
	if (!Number.isInteger(id) || id <= 0) error(400, 'Bad rule id.');
	return id;
};

export const PATCH: RequestHandler = async ({ params, request }) => {
	const body = (await request.json().catch(() => null)) as { enabled?: unknown } | null;
	if (typeof body?.enabled !== 'boolean') error(400, 'enabled must be true or false.');
	if (!(await setRuleEnabled(idOf(params.id), body.enabled))) error(404, 'Rule not found.');
	return json({ ok: true });
};

export const DELETE: RequestHandler = async ({ params }) => {
	if (!(await deleteRule(idOf(params.id)))) error(404, 'Rule not found.');
	return json({ ok: true });
};
