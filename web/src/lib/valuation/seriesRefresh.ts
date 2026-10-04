// Fetching fresh prices from the page, one company at a time so the card can show progress.
// Only runs when someone presses Refresh (the server also refreshes on its daily schedule).

export interface RefreshResult {
	total: number;
	refreshed: number;
	/** Companies Angel One has no listing for (nothing to refresh). */
	unlisted: number;
	failed: number;
}

async function post(url: string): Promise<'ok' | 'unlisted' | 'failed'> {
	try {
		const res = await fetch(url, { method: 'POST' });
		if (res.ok) return 'ok';
		return res.status === 404 ? 'unlisted' : 'failed';
	} catch {
		return 'failed';
	}
}

/** Refreshes the given companies, then the Nifty 50 they are measured against. */
export async function refreshSymbols(
	symbols: string[],
	onProgress: (done: number, total: number) => void = () => {},
	withBenchmark = true
): Promise<RefreshResult> {
	const result: RefreshResult = { total: symbols.length, refreshed: 0, unlisted: 0, failed: 0 };
	onProgress(0, symbols.length);
	for (const [i, symbol] of symbols.entries()) {
		const outcome = await post(`/api/valuation/company/${encodeURIComponent(symbol)}/refresh-series`);
		if (outcome === 'ok') result.refreshed++;
		else if (outcome === 'unlisted') result.unlisted++;
		else result.failed++;
		onProgress(i + 1, symbols.length);
	}
	if (withBenchmark) await post('/api/valuation/refresh-benchmark');
	return result;
}

/** Refreshes every company behind a sector or subsector. Null when its companies could not be listed. */
export async function refreshSector(
	key: string,
	onProgress?: (done: number, total: number) => void
): Promise<RefreshResult | null> {
	try {
		const res = await fetch(`/api/valuation/sector-symbols/${encodeURIComponent(key)}`);
		if (!res.ok) return null;
		const { symbols } = (await res.json()) as { symbols: string[] };
		return refreshSymbols(symbols, onProgress);
	} catch {
		return null;
	}
}
