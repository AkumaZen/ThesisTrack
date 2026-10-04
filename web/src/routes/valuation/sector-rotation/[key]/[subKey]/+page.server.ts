import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { findAnyMajorSector, findAnyCustomSector } from '$lib/valuation/server/sectorStore';

// Static metadata only — no live fetch, so this is instant. Each constituent's own chart/growth
// data, and the basket summary, are fetched one at a time from the client (see +page.svelte).
// Resolves against both built-in and user-imported sectors.
export const load: PageServerLoad = async ({ params }) => {
	const major = await findAnyMajorSector(params.key);
	if (!major) error(404, `Unknown sector "${params.key}"`);

	const sector = await findAnyCustomSector(params.subKey);
	if (!sector || !major.subsectorKeys.includes(sector.key)) {
		error(404, `Unknown basket "${params.subKey}" in sector "${params.key}"`);
	}

	return {
		majorKey: major.key,
		majorLabel: major.label,
		key: sector.key,
		label: sector.label,
		symbols: sector.symbols
	};
};
