import { buildRedFlagRows } from '$lib/valuation/concall/rows';
import * as store from '$lib/valuation/server/concallStore';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const [companies, scans, guidance, watchlists] = await Promise.all([store.listCompanies(), store.listScans(), store.listGuidance(), store.listWatchlistOptions()]);
	const { rows, unscanned } = buildRedFlagRows(companies, scans, guidance);
	return { rows, unscanned, sectors: [...new Set(companies.map((c) => c.sector).filter(Boolean))].sort(), watchlists: watchlists.filter((w) => w.symbols.length) };
};
