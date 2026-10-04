import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getValuationVersion } from '$lib/server/savedValuationsStore';

/** The full content of one version, for comparing against the current valuation. */
export const GET: RequestHandler = async ({ params }) => {
	const id = Number(params.id);
	if (!Number.isInteger(id) || id <= 0) error(400, 'Invalid version id');
	const content = await getValuationVersion(params.symbol, id);
	if (!content) error(404, 'No such version for this company');
	return json(content);
};
