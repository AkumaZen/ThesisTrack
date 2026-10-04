/** A named, team-curated subset of the watchlist (server side: server/watchlistsStore.ts). */
export interface NamedWatchlist {
	id: number;
	name: string;
	createdBy: string;
	createdAt: number;
	symbols: string[];
}

export const WATCHLIST_NAME_MAX = 60;

/** Why a list name is unacceptable, or null. */
export function watchlistNameProblem(name: unknown): string | null {
	if (typeof name !== 'string' || !name.trim()) return 'Give the list a name.';
	if (name.trim().length > WATCHLIST_NAME_MAX)
		return `Keep the name under ${WATCHLIST_NAME_MAX} characters.`;
	return null;
}
