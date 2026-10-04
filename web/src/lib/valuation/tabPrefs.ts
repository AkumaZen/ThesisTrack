import type { UserPrefs } from './prefs';

// The watchlist layout last chosen in this browser tab. The layout's copy of the saved preferences
// is not reloaded on client-side navigation, so the watchlist starts from this one when someone
// comes back to it. "Reset all preferences" forgets it along with everything else.
let latestWatchlist: UserPrefs['watchlist'] | null = null;

export const tabWatchlistPrefs = {
	get: () => latestWatchlist,
	set: (prefs: UserPrefs['watchlist']) => {
		latestWatchlist = prefs;
	},
	clear: () => {
		latestWatchlist = null;
	}
};
