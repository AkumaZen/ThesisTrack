import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { findAnyMajorSector, findAnyCustomSector } from '$lib/valuation/server/sectorStore';

// Static metadata only — no live fetch, so this is instant regardless of cache state. The
// actual per-subsector data (price, returns, signal) is fetched one basket at a time from the
// client (see +page.svelte), same pattern as the major-sector grid one level up. Resolves
// against both built-in and user-imported sectors, so an imported major sector's drilldown
// works identically to a hand-curated one.
export const load: PageServerLoad = async ({ params }) => {
	const major = await findAnyMajorSector(params.key);
	if (!major) error(404, `Unknown sector "${params.key}"`);

	const resolved = await Promise.all(major.subsectorKeys.map((key) => findAnyCustomSector(key)));
	const subsectors = resolved
		.filter((s): s is NonNullable<typeof s> => s != null)
		.map((s) => ({ key: s.key, label: s.label, constituentCount: s.symbols.length }));

	return { majorKey: major.key, majorLabel: major.label, subsectors };
};
