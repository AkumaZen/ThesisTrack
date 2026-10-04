import { sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { savedValuations } from '$lib/server/db/valuationSchema';
import { companies as thesisCompanies } from '$lib/server/db/schema';
import { listAllBaskets, listAllMajorSectors, getSymbolNames } from './sectorStore';
import { searchCompanies } from './search';
import { resolveCompanyNames } from './companyNames';
import type {
	GlobalSearchResults,
	SearchCompany,
	SearchNote,
	SearchSector,
	SearchThesis
} from '../globalSearch';

const MAX_THESES = 5;
const MAX_COMPANIES = 8;
const MAX_SECTORS = 6;
const MAX_NOTES = 8;

/** Lower is better: exact ticker, then names/tickers starting with the query, then contains. */
function rank(q: string, symbol: string, name: string): number | null {
	const s = symbol.toLowerCase();
	const n = name.toLowerCase();
	if (s === q) return 0;
	if (s.startsWith(q) || n.startsWith(q)) return 1;
	if (n.split(/\s+/).some((w) => w.startsWith(q))) return 2;
	if (n.includes(q) || s.includes(q)) return 3;
	return null;
}

async function companies(q: string): Promise<SearchCompany[]> {
	// Companies the team already knows (watchlist + sector baskets) come first and need no network;
	// Screener's own search fills in the rest of the market.
	const [saved, baskets] = await Promise.all([
		db.select({ symbol: savedValuations.symbol, name: savedValuations.name }).from(savedValuations),
		listAllBaskets()
	]);
	const basketSymbols = [...new Set(baskets.flatMap((b) => b.symbols))];
	const basketNames = await getSymbolNames(basketSymbols);
	const savedSet = new Set(saved.map((r) => r.symbol));

	const local = new Map<string, { c: SearchCompany; r: number }>();
	const consider = (symbol: string, name: string, onWatchlist: boolean) => {
		const r = rank(q, symbol, name);
		if (r == null) return;
		const prev = local.get(symbol);
		if (!prev || r < prev.r) local.set(symbol, { c: { symbol, name, onWatchlist }, r });
	};
	for (const row of saved) consider(row.symbol, row.name, true);
	for (const symbol of basketSymbols) {
		consider(symbol, basketNames[symbol] ?? symbol, savedSet.has(symbol));
	}
	const out = [...local.values()]
		.sort((a, b) => a.r - b.r || Number(b.c.onWatchlist) - Number(a.c.onWatchlist))
		.map((x) => x.c)
		.slice(0, MAX_COMPANIES);

	if (out.length < MAX_COMPANIES) {
		try {
			for (const r of await searchCompanies(q)) {
				if (out.length >= MAX_COMPANIES) break;
				if (!out.some((c) => c.symbol === r.symbol)) {
					out.push({ symbol: r.symbol, name: r.name, onWatchlist: savedSet.has(r.symbol) });
				}
			}
		} catch {
			// Screener being slow or down must not hide the local matches.
		}
	}
	return out;
}

async function theses(q: string): Promise<SearchThesis[]> {
	const rows = await db
		.select({
			companyId: thesisCompanies.companyId,
			name: thesisCompanies.name,
			nse: thesisCompanies.nseTicker,
			bse: thesisCompanies.bseTicker
		})
		.from(thesisCompanies);
	return rows
		.map((r) => {
			const ticker = r.nse ?? r.bse ?? null;
			const ranks = [rank(q, r.companyId, r.name), ticker ? rank(q, ticker, r.name) : null].filter(
				(x): x is number => x != null
			);
			return ranks.length ? { t: { companyId: r.companyId, name: r.name, ticker }, r: Math.min(...ranks) } : null;
		})
		.filter((x) => x != null)
		.sort((a, b) => a.r - b.r)
		.slice(0, MAX_THESES)
		.map((x) => x.t);
}

async function sectors(q: string): Promise<SearchSector[]> {
	const [majors, baskets] = await Promise.all([listAllMajorSectors(), listAllBaskets()]);
	const out: (SearchSector & { r: number })[] = [];
	for (const m of majors) {
		const r = rank(q, m.key, m.label);
		if (r != null) out.push({ kind: 'major', key: m.key, label: m.label, parentKey: null, r });
	}
	for (const b of baskets) {
		const r = rank(q, b.key, b.label);
		const parent = majors.find((m) => m.subsectorKeys.includes(b.key));
		// A basket is only reachable through a major sector's page.
		if (r != null && parent) {
			out.push({ kind: 'basket', key: b.key, label: b.label, parentKey: parent.key, r: r + 0.5 });
		}
	}
	return out
		.sort((a, b) => a.r - b.r)
		.slice(0, MAX_SECTORS)
		.map((s) => ({ kind: s.kind, key: s.key, label: s.label, parentKey: s.parentKey }));
}

async function notes(q: string): Promise<SearchNote[]> {
	// Full-text match (stemmed: "margins" finds "margin") or a plain substring, so a partial word
	// or a ticker inside a note still matches. Newest first.
	const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
	const rows = await db.execute<{
		id: number;
		symbol: string;
		kind: 'thesis' | 'note' | 'comment';
		author: string;
		created_at: string;
		snippet: string;
	}>(sql`
		select id, symbol, kind, author, created_at,
			ts_headline('english', body, websearch_to_tsquery('english', ${q}),
				'StartSel=<<, StopSel=>>, MaxWords=24, MinWords=10, MaxFragments=1') as snippet
		from valuation.company_notes
		where deleted_at is null
			and (to_tsvector('english', body) @@ websearch_to_tsquery('english', ${q})
				or body ilike ${like})
		order by created_at desc
		limit ${MAX_NOTES}`);
	const names = await resolveCompanyNames([...new Set(rows.map((r) => r.symbol))]);
	return rows.map((r) => ({
		id: r.id,
		symbol: r.symbol,
		companyName: names[r.symbol] ?? r.symbol,
		kind: r.kind,
		author: r.author,
		createdAt: Number(r.created_at),
		snippet: r.snippet
	}));
}

export async function globalSearch(raw: string): Promise<GlobalSearchResults> {
	const q = raw.trim().toLowerCase().slice(0, 100);
	if (q.length < 2) return { query: q, theses: [], companies: [], sectors: [], notes: [] };
	const [t, c, s, n] = await Promise.all([theses(q), companies(q), sectors(q), notes(q)]);
	return { query: q, theses: t, companies: c, sectors: s, notes: n };
}
