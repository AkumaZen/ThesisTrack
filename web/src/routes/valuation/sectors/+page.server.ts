import type { PageServerLoad } from './$types';
import { getTaxonomySnapshot } from '$lib/valuation/server/sectorStore';

// The whole editable taxonomy in one instant DB read (no live market data), so the manager
// renders immediately and every edit just re-runs this load.
export const load: PageServerLoad = async () => getTaxonomySnapshot();
