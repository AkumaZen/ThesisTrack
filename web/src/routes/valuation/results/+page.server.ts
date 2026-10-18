import type { PageServerLoad } from './$types';
import { listAllBaskets } from '$lib/valuation/server/sectorStore';
import { listWatchlists } from '$lib/valuation/server/watchlistsStore';
import { listSavedValuationRows } from '$lib/valuation/server/savedValuationsStore';
import { readStoredFinancials, symbolsMissingFinancials } from '$lib/valuation/server/fundamentalStore';
import { buildResultsRow, type ResultsRow } from '$lib/valuation/quarterlyResults';

// Reads stored Screener results only: nothing here fetches. Companies nobody has opened have no stored
// record until "Load missing financials" (admin/read-write) brings the scanner universe in.
export const load: PageServerLoad = async () => {
	const [stored, baskets, lists, saved, missing] = await Promise.all([
		readStoredFinancials(),
		listAllBaskets(),
		listWatchlists().catch(() => []),
		listSavedValuationRows().catch(() => []),
		symbolsMissingFinancials().catch((): string[] => [])
	]);
	const basketsBySymbol = new Map<string, string[]>();
	for (const b of baskets) for (const s of b.symbols) basketsBySymbol.set(s, [...(basketsBySymbol.get(s) ?? []), b.label]);

	const rows: ResultsRow[] = [];
	for (const c of stored) {
		const row = buildResultsRow({ ...c, baskets: basketsBySymbol.get(c.symbol) ?? [] });
		if (row) rows.push(row);
	}
	const industries = [...new Set(rows.map((r) => r.industry).filter((i): i is string => !!i))].sort((a, b) =>
		a.localeCompare(b)
	);
	const basketLabels = [...new Set(baskets.map((b) => b.label))].sort((a, b) => a.localeCompare(b));
	return {
		rows,
		industries,
		baskets: basketLabels,
		lists: [
			{ key: 'main', name: 'Main watchlist', symbols: saved.map((s) => s.symbol) },
			...lists.map((l) => ({ key: `list:${l.id}`, name: l.name, symbols: l.symbols }))
		],
		missing: missing.length
	};
};
