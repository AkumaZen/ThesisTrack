/** One line of the team activity feed (see server/activityStore.ts). */
export interface ActivityEntry {
	id: number;
	at: number;
	actor: string;
	/** valuation | note | comment | status | coverage | watchlist | template | settings */
	kind: string;
	symbol: string | null;
	summary: string;
}

/** "just now", "5 min ago", "3 h ago", "yesterday", then a date. Pure, for tests. */
export function timeAgo(at: number, now = Date.now()): string {
	const s = Math.max(0, Math.round((now - at) / 1000));
	if (s < 45) return 'just now';
	const m = Math.round(s / 60);
	if (m < 60) return `${m} min ago`;
	const h = Math.round(m / 60);
	if (h < 24) return `${h} h ago`;
	const d = Math.round(h / 24);
	if (d === 1) return 'yesterday';
	if (d < 7) return `${d} days ago`;
	return new Date(at).toLocaleDateString('en-IN', {
		day: 'numeric',
		month: 'short',
		year: 'numeric'
	});
}
