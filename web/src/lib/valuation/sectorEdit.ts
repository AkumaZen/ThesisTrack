// Pure helpers for the Sector Manager — shared by the server store and unit tests, no I/O.

/** Same key shape as every hand-written key in customSectors.ts (keys double as route params). */
export const KEY_RE = /^[a-z0-9][a-z0-9_-]*$/;

/** NSE symbols are upper-case letters/digits plus `&` and `-` (e.g. M&M, GVT&D, BAJAJ-AUTO). */
export const SYMBOL_RE = /^[A-Z0-9][A-Z0-9&-]{0,29}$/;

export function normalizeSymbol(raw: string): string {
	return raw.trim().toUpperCase();
}

/** Turns a human label into a URL-safe key: "Power Transformers (HV)" -> "power_transformers_hv". */
export function slugifyKey(label: string): string {
	const slug = label
		.trim()
		.toLowerCase()
		.replace(/&/g, ' and ')
		.replace(/[^a-z0-9]+/g, '_')
		.replace(/^_+|_+$/g, '');
	return slug || 'sector';
}

/** First free key for `label`: the bare slug, else `slug_2`, `slug_3`, ... */
export function uniqueKey(label: string, taken: Iterable<string>): string {
	const used = new Set(taken);
	const base = slugifyKey(label);
	if (!used.has(base)) return base;
	for (let n = 2; ; n++) {
		const candidate = `${base}_${n}`;
		if (!used.has(candidate)) return candidate;
	}
}

export interface ScreenerSearchHit {
	name?: string;
	url?: string;
}

export interface SymbolSuggestion {
	symbol: string;
	name: string;
}

/** Screener company URLs look like `/company/TCS/consolidated/`; the slug is the symbol. */
export function symbolFromScreenerUrl(url: string): string | null {
	const m = url.match(/\/company\/([^/]+)/i);
	return m ? decodeURIComponent(m[1]).toUpperCase() : null;
}

/**
 * A symbol only counts as verified when Screener returns a company whose own slug equals it
 * exactly. A fuzzy name match is never accepted (the project's "never guess a symbol" rule) —
 * near misses come back as suggestions for a human to pick from instead.
 */
export function resolveSymbolMatch(
	symbol: string,
	hits: ScreenerSearchHit[]
): { match: SymbolSuggestion | null; suggestions: SymbolSuggestion[] } {
	const wanted = normalizeSymbol(symbol);
	const suggestions: SymbolSuggestion[] = [];
	for (const hit of hits) {
		if (!hit.name || !hit.url) continue;
		const slug = symbolFromScreenerUrl(hit.url);
		if (!slug) continue;
		suggestions.push({ symbol: slug, name: hit.name });
	}
	const match = suggestions.find((s) => s.symbol === wanted) ?? null;
	return { match, suggestions: match ? [] : suggestions.slice(0, 5) };
}

const BSE_CODE_RE = /^\d{6}$/;
const sameName = (a: string, b: string) =>
	a.toLowerCase().replace(/[^a-z0-9]/g, '') === b.toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * When Screener has no page under an NSE ticker (some companies only appear there by their BSE
 * code, e.g. ASM Technologies is /company/526433/, not /company/ASMTEC/), finds that BSE-code
 * page among the search hits for the ticker. Still no guessing: the hit must carry the company's
 * known name, or be the only company the search returned.
 */
export function bseFallback(
	suggestions: SymbolSuggestion[],
	knownName: string | null | undefined
): SymbolSuggestion | null {
	const codes = suggestions.filter((s) => BSE_CODE_RE.test(s.symbol));
	if (knownName) {
		const named = codes.filter((s) => sameName(s.name, knownName));
		if (named.length === 1) return named[0];
	}
	return suggestions.length === 1 && codes.length === 1 ? codes[0] : null;
}
