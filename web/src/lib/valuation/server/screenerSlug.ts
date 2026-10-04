import { getSymbolNames } from './sectorStore';
import {
	bseFallback,
	normalizeSymbol,
	resolveSymbolMatch,
	type ScreenerSearchHit,
	type SymbolSuggestion
} from '../sectorEdit';

const USER_AGENT =
	'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

/** Screener.in's company search. Throws when Screener can't be reached. */
export async function screenerSearch(q: string): Promise<ScreenerSearchHit[]> {
	const res = await fetch(`https://www.screener.in/api/company/search/?q=${encodeURIComponent(q)}`, {
		headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' }
	});
	if (!res.ok) throw new Error(`HTTP ${res.status}`);
	return (await res.json()) as ScreenerSearchHit[];
}

export type ScreenerLookup =
	| { kind: 'exact'; page: SymbolSuggestion }
	| { kind: 'bse'; page: SymbolSuggestion }
	| { kind: 'none'; suggestions: SymbolSuggestion[] };

/**
 * Finds the Screener page for an NSE ticker: the page under the ticker itself, or, when Screener
 * only lists the company by its BSE code, that page (see `bseFallback` for when that is allowed).
 */
export async function lookupScreenerPage(raw: string): Promise<ScreenerLookup> {
	const symbol = normalizeSymbol(raw);
	const { match, suggestions } = resolveSymbolMatch(symbol, await screenerSearch(symbol));
	if (match) return { kind: 'exact', page: match };
	const knownName = (await getSymbolNames([symbol]))[symbol];
	const page = bseFallback(suggestions, knownName);
	return page ? { kind: 'bse', page } : { kind: 'none', suggestions };
}

const slugs = new Map<string, string | null>();

/**
 * The BSE code to read from Screener for a ticker whose own page doesn't exist there, or null.
 * Remembered for the life of the server; only consulted after Screener has said "not found".
 */
export async function bseSlugFor(symbol: string): Promise<string | null> {
	const key = normalizeSymbol(symbol);
	if (slugs.has(key)) return slugs.get(key) ?? null;
	const found = await lookupScreenerPage(key);
	const slug = found.kind === 'bse' ? found.page.symbol : null;
	slugs.set(key, slug);
	return slug;
}
