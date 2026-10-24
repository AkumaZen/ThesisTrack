import type { PageServerLoad } from './$types';
import { listSections } from '$lib/valuation/server/marketIntelStore';
import { listSavedValuationRows } from '$lib/valuation/server/savedValuationsStore';
import { toNamedWatchlist } from '$lib/valuation/watchlists';
import { showcaseOnly } from '$lib/server/showcase';
import { isGuest } from '$lib/guest';

/** Id of the guest's one read-only list; real section ids are positive. */
const SHOWCASE_LIST_ID = -1;

// The person's own lists (watchlist sections), so the watchlist's view tabs render on first paint.
// Their columns/sort/view come from the root layout (data.prefs). A guest has no lists of their
// own, so they get one synthetic "Showcase companies" list instead.
export const load: PageServerLoad = async ({ locals }) => {
	if (isGuest(locals.user)) {
		const rows = await showcaseOnly(await listSavedValuationRows().catch(() => []), true);
		const items = rows.map((r) => ({ nseSymbol: r.symbol, companyName: r.name, flagColor: null, flagLabel: null }));
		return { watchlists: [toNamedWatchlist({ id: SHOWCASE_LIST_ID, name: 'Showcase companies', items })] };
	}
	return { watchlists: (await listSections(locals.user!.id)).map(toNamedWatchlist) };
};
