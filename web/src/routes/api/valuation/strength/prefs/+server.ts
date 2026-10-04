import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { parseStrengthConfig } from '$lib/valuation/strength';
import { getFilterPref, isStrengthLevel, saveFilterPref } from '$lib/valuation/server/strengthRulesStore';

/** The signed-in person's last-used filter for a view level (null when they have none yet). */
export const GET: RequestHandler = async ({ url, locals }) => {
	const level = url.searchParams.get('level');
	if (!isStrengthLevel(level)) error(400, 'Unknown level.');
	return json({ config: await getFilterPref(locals.user!.id, level) });
};

export const PUT: RequestHandler = async ({ request, locals }) => {
	const body = (await request.json().catch(() => null)) as { level?: unknown; config?: unknown } | null;
	if (!isStrengthLevel(body?.level)) error(400, 'Unknown level.');
	const config = parseStrengthConfig(body?.config);
	await saveFilterPref(locals.user!.id, body.level, config);
	return json({ config });
};
