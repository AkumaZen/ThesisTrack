import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getTaxonomySnapshot } from '$lib/valuation/server/sectorStore';
import type { RefreshPlan } from '$lib/valuation/refreshAll';

// Everything "Refresh all sectors" walks through, in order: each sector, its subsectors, and the
// companies in them. Metadata only (no prices, no Angel One), so it is instant; the page then
// refreshes the companies one request at a time.
export const GET: RequestHandler = async () => {
	const { majors, baskets } = await getTaxonomySnapshot();
	const byKey = new Map(baskets.map((b) => [b.key, b]));
	const plan: RefreshPlan = {
		sectors: majors.map((m) => ({
			key: m.key,
			label: m.label,
			subsectors: m.subsectorKeys.flatMap((key) => {
				const b = byKey.get(key);
				return b ? [{ key: b.key, label: b.label, symbols: b.symbols }] : [];
			})
		}))
	};
	return json(plan);
};
