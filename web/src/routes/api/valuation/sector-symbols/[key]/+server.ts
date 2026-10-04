import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { findAnyCustomSector, findAnyMajorSector } from '$lib/valuation/server/sectorStore';

// The companies behind one sector or subsector (a sector's own subsectors, flattened and
// deduplicated), so the page can refresh their prices one by one with progress.
export const GET: RequestHandler = async ({ params }) => {
	const subsector = await findAnyCustomSector(params.key);
	if (subsector) return json({ symbols: subsector.symbols });

	const major = await findAnyMajorSector(params.key);
	if (!major) error(404, `Unknown sector "${params.key}"`);
	const seen = new Set<string>();
	for (const key of major.subsectorKeys) {
		const sub = await findAnyCustomSector(key);
		for (const symbol of sub?.symbols ?? []) seen.add(symbol);
	}
	return json({ symbols: [...seen] });
};
