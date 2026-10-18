import type { PageServerLoad } from './$types';
import { parseInsiderFilters } from '$lib/valuation/insiderTrades';
import { listInsiderTrades, listSast } from '$lib/valuation/server/marketIntelStore';

// Insider trading (SEBI PIT) and substantial acquisition (SAST) disclosures stored from NSE.
export const load: PageServerLoad = async ({ url }) => {
	const filters = parseInsiderFilters(url.searchParams);
	const tab = url.searchParams.get('tab') === 'sast' ? 'sast' : 'pit';
	const result = tab === 'sast' ? await listSast(filters) : await listInsiderTrades(filters);
	return {
		tab,
		filters,
		items: result.items,
		hasMore: result.hasMore
	};
};
