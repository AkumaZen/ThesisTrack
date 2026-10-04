import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSectorReturn } from '$lib/valuation/server/sectorRotationCache';
import { findAnyCustomSector } from '$lib/valuation/server/sectorStore';

// One sector's rotation data — the overview page fetches these one at a time (see
// +page.svelte) so 56 baskets render progressively instead of blocking on all of them at once.
export const GET: RequestHandler = async ({ params }) => {
	const sector = await findAnyCustomSector(params.key);
	if (!sector) error(404, `Unknown sector "${params.key}"`);

	try {
		const data = await getSectorReturn(sector);
		return json(data);
	} catch (e) {
		const message = e instanceof Error ? e.message : 'Unknown error';
		if (message === 'ANGEL_CREDENTIALS_MISSING') {
			error(500, 'Angel One API credentials are not configured on the server.');
		}
		error(502, message);
	}
};
