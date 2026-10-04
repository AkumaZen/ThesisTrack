import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { parseStrengthConfig } from '$lib/valuation/strength';
import {
	getFilterPref,
	isFilterScope,
	isStrengthLevel,
	saveFilterPref
} from '$lib/valuation/server/strengthRulesStore';

/**
 * The signed-in person's last-used filter for one place: a view level, and within it the sector,
 * subsector or company (`scope`, '' for the list of every sector). Null when they have none yet.
 */
export const GET: RequestHandler = async ({ url, locals }) => {
	const level = url.searchParams.get('level');
	const scope = url.searchParams.get('scope') ?? '';
	if (!isStrengthLevel(level)) error(400, 'Unknown level.');
	if (!isFilterScope(scope)) error(400, 'Unknown scope.');
	return json({ config: await getFilterPref(locals.user!.id, level, scope) });
};

export const PUT: RequestHandler = async ({ request, locals }) => {
	const body = (await request.json().catch(() => null)) as
		| { level?: unknown; scope?: unknown; config?: unknown }
		| null;
	const scope = body?.scope ?? '';
	if (!isStrengthLevel(body?.level)) error(400, 'Unknown level.');
	if (!isFilterScope(scope)) error(400, 'Unknown scope.');
	const config = parseStrengthConfig(body?.config);
	await saveFilterPref(locals.user!.id, body.level, config, scope);
	return json({ config });
};
