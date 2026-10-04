import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { parseRepeat, parseStrengthConfig, isStrengthActive } from '$lib/valuation/strength';
import { createRule, isStrengthLevel, listRules } from '$lib/valuation/server/strengthRulesStore';
import { findAnyCustomSector, findAnyMajorSector } from '$lib/valuation/server/sectorStore';

export const GET: RequestHandler = async () => json({ rules: await listRules() });

/** Saves the filter config a person is looking at as an alert rule. The rule stores exactly that
 *  config, so the alerts evaluate what the filter showed. */
export const POST: RequestHandler = async ({ request, locals }) => {
	const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
	if (!body) error(400, 'Invalid body.');
	if (!isStrengthLevel(body.level)) error(400, 'Unknown level.');
	const level = body.level;

	const config = parseStrengthConfig(body.config);
	if (!isStrengthActive(config, level === 'company' || level === 'companies' ? 'company' : 'group'))
		error(400, 'Switch on at least one signal before saving an alert.');

	const parentKey = typeof body.parentKey === 'string' && body.parentKey ? body.parentKey : null;
	if (level === 'company' && !parentKey) error(400, 'A company alert needs the company symbol.');
	if (level === 'subsectors' && parentKey && !(await findAnyMajorSector(parentKey))) error(400, 'Unknown sector.');
	if (level === 'companies' && parentKey && !(await findAnyCustomSector(parentKey))) error(400, 'Unknown subsector.');

	const name =
		typeof body.name === 'string' && body.name.trim() ? body.name.trim().slice(0, 120) : 'Strength & Volume';
	const rule = await createRule({
		name,
		level,
		parentKey: level === 'company' ? parentKey!.toUpperCase() : parentKey,
		config,
		repeat: parseRepeat(body.repeat),
		userId: locals.user!.id
	});
	return json({ rule }, { status: 201 });
};
