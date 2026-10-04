import type { PageServerLoad } from './$types';
import { getTaxonomySnapshot } from '$lib/valuation/server/sectorStore';
import type { SectorSearchEntry } from '$lib/valuation/sectorSearch';

// Sector metadata only (built-in major sectors plus imported ones): no price data, so this is
// instant. Each card's figures are loaded from stored prices when it is opened (see +page.svelte).
export const load: PageServerLoad = async () => {
	const { majors, baskets, names } = await getTaxonomySnapshot();
	const basketByKey = new Map(baskets.map((b) => [b.key, b]));

	// Everything the page's search box can find, built once here so typing needs no requests:
	// each sector, each subsector (with its sector) and each company (with where it sits).
	const search: SectorSearchEntry[] = [];
	for (const m of majors) {
		search.push({ kind: 'sector', label: m.label, majorKey: m.key, majorLabel: m.label });
		for (const key of m.subsectorKeys) {
			const b = basketByKey.get(key);
			if (!b) continue;
			search.push({ kind: 'subsector', label: b.label, majorKey: m.key, majorLabel: m.label, subKey: b.key });
			for (const symbol of b.symbols) {
				search.push({
					kind: 'company',
					label: names[symbol] ?? symbol,
					symbol,
					majorKey: m.key,
					majorLabel: m.label,
					subKey: b.key,
					subLabel: b.label
				});
			}
		}
	}

	return {
		majors: majors.map((m) => ({
			key: m.key,
			label: m.label,
			subsectorCount: m.subsectorKeys.length
		})),
		search
	};
};
