import type { PageServerLoad } from './$types';
import { listSections } from '$lib/valuation/server/marketIntelStore';
import { toNamedWatchlist } from '$lib/valuation/watchlists';

// The person's own lists (watchlist sections), so the watchlist's view tabs render on first paint.
// Their columns/sort/view come from the root layout (data.prefs).
export const load: PageServerLoad = async ({ locals }) => ({
	watchlists: (await listSections(locals.user!.id)).map(toNamedWatchlist)
});
