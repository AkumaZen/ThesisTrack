// Fetching fresh prices from the page, in batches of 50 companies (one Angel One quote request
// each, see refreshAll.ts) so the card can show progress; a single company takes its own request.
// Only runs when someone presses Refresh (the server also refreshes on its daily schedule).
import { forgetCards } from './cardCache';
import { BATCH_SIZE, summariseBatch } from './refreshAll';

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

/** One batch request; null when the request itself failed (network, 4xx/5xx). */
async function postBatch(symbols: string[]): Promise<ReturnType<typeof summariseBatch> | null> {
	try {
		const res = await fetch('/api/valuation/refresh-batch', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ symbols })
		});
		if (!res.ok) return null;
		return summariseBatch(((await res.json()) as { results: { symbol: string; outcome: string }[] }).results);
	} catch {
		return null;
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
	const single = async (symbol: string) => {
		const outcome = await post(`/api/valuation/company/${encodeURIComponent(symbol)}/refresh-series`);
		if (outcome === 'ok') result.refreshed++;
		else if (outcome === 'unlisted') result.unlisted++;
		else result.failed++;
	};
	let done = 0;
	if (symbols.length === 1) {
		await single(symbols[0]);
		onProgress(1, 1);
	} else {
		for (let i = 0; i < symbols.length; i += BATCH_SIZE) {
			const part = symbols.slice(i, i + BATCH_SIZE);
			const counts = await postBatch(part);
			if (counts) {
				result.refreshed += counts.ok;
				result.unlisted += counts.unlisted;
				result.failed += counts.failed.length;
				done += part.length;
				onProgress(done, symbols.length);
			} else {
				// The batch request itself failed: do what Refresh always did, one company each.
				for (const symbol of part) {
					await single(symbol);
					onProgress(++done, symbols.length);
				}
			}
		}
	}
	if (withBenchmark) await post('/api/valuation/refresh-benchmark');
	// New prices change these companies' charts and every sector figure built from them.
	for (const symbol of symbols) forgetCards(`/api/valuation/company/${encodeURIComponent(symbol)}/`);
	forgetCards('/api/valuation/sector-rotation');
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
