import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getMajorSectorReturn } from '$lib/valuation/server/sectorRotationCache';
import { findAnyMajorSector } from '$lib/valuation/server/sectorStore';

// One major sector's rolled-up rotation data — the major-sector grid fetches these one at a
// time (see +page.svelte), same progressive-load reasoning as /api/sector-rotation/[key].
export const GET: RequestHandler = async ({ params }) => {
	const major = await findAnyMajorSector(params.key);
	if (!major) error(404, `Unknown major sector "${params.key}"`);

	try {
		const data = await getMajorSectorReturn(major);
		return json(data);
	} catch (e) {
		const message = e instanceof Error ? e.message : 'Unknown error';
		if (message === 'ANGEL_CREDENTIALS_MISSING') {
			error(500, 'Angel One API credentials are not configured on the server.');
		}
		error(502, message);
	}
};
