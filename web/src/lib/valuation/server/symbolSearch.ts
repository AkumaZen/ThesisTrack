import { db } from '$lib/server/db';
import { savedValuations } from '$lib/server/db/valuationSchema';
import { listAllBaskets, getSymbolNames } from './sectorStore';
import { searchCompanies } from './search';
import { rank } from './globalSearch';
import { angelListings } from './angelone';
import type { SymbolHit } from '../symbolSearch';

const MAX = 8;
const TTL_MS = 10 * 60 * 1000;
const cache = new Map<string, { at: number; hits: SymbolHit[] }>();
const sameCompany = (a: string, b: string) =>
	a.toLowerCase().replace(/[^a-z0-9]/g, '') === b.toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Suggestions for the company picker as someone types a name or ticker. Companies the team already
 * tracks (watchlist and sector baskets) come first and cost nothing; Screener.in's search covers the
 * rest of the market and supplies the real company names. Each suggestion says whether Angel One
 * can price it. Recent queries are remembered for a few minutes so typing stays quick.
 */
export async function searchSymbols(raw: string): Promise<SymbolHit[]> {
	const q = raw.trim().toLowerCase();
	if (q.length < 2) return [];
	const hit = cache.get(q);
	if (hit && Date.now() - hit.at < TTL_MS) return hit.hits;

	const [saved, baskets] = await Promise.all([
		db.select({ symbol: savedValuations.symbol, name: savedValuations.name }).from(savedValuations),
		listAllBaskets()
	]);
	const basketSymbols = [...new Set(baskets.flatMap((b) => b.symbols))];
	const names = await getSymbolNames(basketSymbols);
	const known = new Map<string, string>();
	for (const s of basketSymbols) known.set(s, names[s] ?? s);
	for (const r of saved) known.set(r.symbol, r.name || known.get(r.symbol) || r.symbol);

	const local = [...known.entries()]
		.map(([symbol, name]) => ({ symbol, name, r: rank(q, symbol, name) }))
		.filter((x): x is { symbol: string; name: string; r: number } => x.r != null)
		.sort((a, b) => a.r - b.r || a.name.localeCompare(b.name))
		.slice(0, MAX);

	const found: { symbol: string; name: string; tracked: boolean }[] = local.map((x) => ({
		symbol: x.symbol,
		name: x.name,
		tracked: true
	}));
	if (found.length < MAX) {
		try {
			for (const r of await searchCompanies(q)) {
				if (found.length >= MAX) break;
				if (found.some((f) => f.symbol === r.symbol)) continue;
				// Screener also lists some companies under their BSE code; when the same company is
				// already here by its NSE ticker, the BSE-code entry would only add a duplicate.
				if (/^\d{6}$/.test(r.symbol) && found.some((f) => sameCompany(f.name, r.name))) continue;
				found.push({ symbol: r.symbol, name: r.name, tracked: known.has(r.symbol) });
			}
		} catch {
			// Screener slow or down: the companies we already know still show.
		}
	}

	const listed = await angelListings(found.map((f) => f.symbol));
	const hits = found.map((f) => ({ ...f, priceable: listed ? (listed.get(f.symbol) ?? false) : null }));
	// Only remember complete answers, so an "unknown" badge is not kept for minutes.
	if (listed) cache.set(q, { at: Date.now(), hits });
	return hits;
}
