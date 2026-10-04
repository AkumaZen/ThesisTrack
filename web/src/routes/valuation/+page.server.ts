import type { PageServerLoad } from './$types';
import { listWatchlists } from '$lib/server/watchlistsStore';

// The team's named lists, so the watchlist's view tabs render on first paint. The person's own
// columns/sort/view come from the root layout (data.prefs).
export const load: PageServerLoad = async () => ({ watchlists: await listWatchlists() });
