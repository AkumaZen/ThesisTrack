import type { SectionWithItems } from '$lib/valuation/server/marketIntelStore';

/** One of the person's lists (a watchlist section), as the watchlist tabs and Lists menu use it. */
export interface NamedWatchlist {
	id: number;
	name: string;
	symbols: string[];
	/** Colour flag and short label per company, only for companies that have one. */
	flags: Record<string, { color: string | null; label: string | null }>;
}

export function toNamedWatchlist(s: Pick<SectionWithItems, 'id' | 'name' | 'items'>): NamedWatchlist {
	const flags: NamedWatchlist['flags'] = {};
	for (const i of s.items) if (i.flagColor || i.flagLabel) flags[i.nseSymbol] = { color: i.flagColor, label: i.flagLabel };
	return { id: s.id, name: s.name, symbols: s.items.map((i) => i.nseSymbol), flags };
}
