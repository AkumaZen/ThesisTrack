import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { parseStrengthConfig } from '$lib/valuation/strength';
import { evaluateLevel } from '$lib/valuation/server/strengthEngine';
import { isStrengthLevel } from '$lib/valuation/server/strengthRulesStore';

/** Evaluates a Strength & Volume config over one view: all sectors, the subsectors of a sector,
 *  the companies of a subsector, or a single company. GET so every signed-in role can filter;
 *  the config travels as JSON in `config`. */
export const GET: RequestHandler = async ({ url }) => {
	const level = url.searchParams.get('level');
	if (!isStrengthLevel(level)) error(400, 'level must be sectors, subsectors, companies or company.');
	let raw: unknown = null;
	const configParam = url.searchParams.get('config');
	if (configParam) {
		try {
			raw = JSON.parse(configParam);
		} catch {
			error(400, 'config must be valid JSON.');
		}
	}
	const parent = url.searchParams.get('parent');
	if (level === 'company' && !parent) error(400, 'parent (the symbol) is required for a single company.');
	const result = await evaluateLevel(level, parent, parseStrengthConfig(raw));
	return json(result);
};
