import type { MethodId } from './valuationEngine';

export interface ScenarioRead {
	impliedPrice: number | null;
	cagrPct: number | null;
	pctAchieved: number | null;
}

export interface WatchRowData {
	cmp: number | null;
	marketCap: number | null;
	method: MethodId | null;
	methodLabel: string | null;
	bear: ScenarioRead;
	base: ScenarioRead;
	bull: ScenarioRead;
	sparkline: number[] | null;
	fetchedAt: number;
	error: boolean;
}

// Module scope, not component state — this survives SvelteKit's client-side navigation (the
// home page's +page.svelte is torn down and recreated every time you navigate back to '/', but
// an imported module isn't re-evaluated on that navigation). Without this, every visit to the
// watchlist re-fetched and re-rendered every row's price/CAGR/sparkline from scratch, even
// though the server already had all of it cached (companyCache: 24h TTL, sparklineCache: 30min
// TTL) — the round trip plus the "loading…" flash on every row was pure waste. A hard page
// reload still clears it, which is correct: that's a real new JS context, not just an SPA nav.
const rowCache = new Map<string, WatchRowData>();

// Shorter than the server's own cache TTLs, so a tab left open for a while still eventually
// reflects a manual "Refresh price" click or the next day's scrape, without re-fetching on
// every navigation within one short working session.
const CLIENT_TTL_MS = 5 * 60 * 1000;

export function getCachedRow(symbol: string): WatchRowData | null {
	const row = rowCache.get(symbol);
	if (!row) return null;
	if (Date.now() - row.fetchedAt > CLIENT_TTL_MS) return null;
	return row;
}

export function setCachedRow(symbol: string, data: WatchRowData) {
	rowCache.set(symbol, data);
}

export function evictCachedRow(symbol: string) {
	rowCache.delete(symbol);
}
