import type { PageServerLoad } from './$types';
import { PERIODS, type Period } from '$lib/valuation/returns';
import { RETURN_INDICES } from '$lib/valuation/server/longRangeStore';
import { readReturnItems } from '$lib/valuation/server/returnsStore';
import { listSavedValuationRows } from '$lib/valuation/server/savedValuationsStore';

/** At most this many stocks at once: the chart stays readable and the page reads a bounded amount. */
const MAX_STOCKS = 12;
const DEFAULT_STOCKS = 4;

// Stored prices only. The selection lives in the URL (?s=TICKER,TICKER&i=IDX:NIFTY50&p=6M) so a view can be shared.
export const load: PageServerLoad = async ({ url }) => {
	const asked = url.searchParams.get('s');
	let symbols: string[];
	if (asked !== null) {
		symbols = [...new Set(asked.split(',').map((s) => s.trim().toUpperCase()).filter((s) => /^[A-Z0-9&_.-]{1,20}$/.test(s)))];
	} else {
		const saved = await listSavedValuationRows().catch(() => []);
		symbols = saved.slice(0, DEFAULT_STOCKS).map((s) => s.symbol);
	}
	symbols = symbols.slice(0, MAX_STOCKS);
	const indexParam = url.searchParams.get('i');
	const indexKeys =
		indexParam === null
			? RETURN_INDICES.map((i) => i.key)
			: indexParam.split(',').filter((k) => RETURN_INDICES.some((i) => i.key === k));
	const periodParam = url.searchParams.get('p');
	const period = (PERIODS as readonly string[]).includes(periodParam ?? '') ? (periodParam as Period) : '6M';
	return {
		items: await readReturnItems(symbols, indexKeys),
		symbols,
		indexKeys,
		indices: RETURN_INDICES.map(({ key, label }) => ({ key, label })),
		period,
		maxStocks: MAX_STOCKS
	};
};
