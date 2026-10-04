// Shapes returned by /api/valuation/search/all, shared by the server and the nav search box.

export interface SearchCompany {
	symbol: string;
	name: string;
	onWatchlist: boolean;
}

export interface SearchSector {
	kind: 'major' | 'basket';
	key: string;
	label: string;
	/** For a basket: the major sector whose page it sits under. */
	parentKey: string | null;
}

export interface SearchNote {
	id: number;
	symbol: string;
	companyName: string;
	kind: 'thesis' | 'note' | 'comment';
	author: string;
	createdAt: number;
	/** An excerpt with matches wrapped in << and >>. */
	snippet: string;
}

/** A company with an investment thesis (the thesis module). */
export interface SearchThesis {
	companyId: string;
	name: string;
	ticker: string | null;
}

export interface GlobalSearchResults {
	query: string;
	theses: SearchThesis[];
	companies: SearchCompany[];
	sectors: SearchSector[];
	notes: SearchNote[];
}

/** Splits a ts_headline excerpt into plain and highlighted parts, so the UI can render the
 *  highlights as elements rather than as HTML. */
export function snippetParts(snippet: string): { text: string; hit: boolean }[] {
	const out: { text: string; hit: boolean }[] = [];
	const re = /<<(.*?)>>/g;
	let last = 0;
	for (const m of snippet.matchAll(re)) {
		if (m.index > last) out.push({ text: snippet.slice(last, m.index), hit: false });
		out.push({ text: m[1], hit: true });
		last = m.index + m[0].length;
	}
	if (last < snippet.length) out.push({ text: snippet.slice(last), hit: false });
	return out;
}
