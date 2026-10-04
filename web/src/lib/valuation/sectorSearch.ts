// The Sector rotation search box: finds sectors, subsectors and the companies in them, from the
// sector baskets the page already has (no requests while typing).

export type SectorSearchEntry =
	| { kind: 'sector'; label: string; majorKey: string; majorLabel: string }
	| { kind: 'subsector'; label: string; majorKey: string; majorLabel: string; subKey: string }
	| {
			kind: 'company';
			label: string;
			symbol: string;
			majorKey: string;
			majorLabel: string;
			subKey: string;
			subLabel: string;
	  };

const KIND_ORDER = { sector: 0, subsector: 1, company: 2 } as const;

/** Lower is better: the start of the name or ticker, then the start of any word, then anywhere. */
function score(q: string, entry: SectorSearchEntry): number | null {
	const label = entry.label.toLowerCase();
	const symbol = entry.kind === 'company' ? entry.symbol.toLowerCase() : '';
	if (symbol === q) return 0;
	if (label.startsWith(q) || (symbol && symbol.startsWith(q))) return 1;
	if (label.split(/[\s&/(),-]+/).some((w) => w.startsWith(q))) return 2;
	if (label.includes(q) || (symbol && symbol.includes(q))) return 3;
	return null;
}

/** Matches for `query`, best first: sectors and subsectors before companies at the same strength.
 *  A company sitting in several subsectors appears once per place, so each place can be opened. */
export function searchSectors(entries: SectorSearchEntry[], query: string, limit = 12): SectorSearchEntry[] {
	const q = query.trim().toLowerCase();
	if (q.length < 2) return [];
	return entries
		.map((e) => ({ e, s: score(q, e) }))
		.filter((x): x is { e: SectorSearchEntry; s: number } => x.s != null)
		.sort((a, b) => a.s - b.s || KIND_ORDER[a.e.kind] - KIND_ORDER[b.e.kind] || a.e.label.localeCompare(b.e.label))
		.slice(0, limit)
		.map((x) => x.e);
}
