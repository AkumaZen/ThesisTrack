// Guest mode: which companies a visitor without an account may see. A company is showcased by its
// listing symbol (uppercase NSE ticker, else BSE - the same symbol priceSymbol() gives a thesis
// company and the valuation tools use), so one switch covers its thesis, saved valuation and notes.
import { asc, eq } from 'drizzle-orm';
import { db } from './db';
import { companies, customTables, showcaseSymbols } from './db/schema';
import { priceSymbol } from './services/entryPrice';

// The set is tiny and read on every guest request, so it is cached briefly. A write here clears
// it at once; another server instance picks a change up within CACHE_MS.
const CACHE_MS = 30_000;
let cache: { at: number; symbols: Set<string> } | null = null;

export const normalizeShowcaseSymbol = (raw: string): string => raw.trim().toUpperCase();

async function showcaseSet(): Promise<Set<string>> {
	if (cache && Date.now() - cache.at < CACHE_MS) return cache.symbols;
	const rows = await db.select({ symbol: showcaseSymbols.symbol }).from(showcaseSymbols);
	cache = { at: Date.now(), symbols: new Set(rows.map((r) => r.symbol)) };
	return cache.symbols;
}

export async function listShowcaseSymbols(): Promise<string[]> {
	const rows = await db
		.select({ symbol: showcaseSymbols.symbol })
		.from(showcaseSymbols)
		.orderBy(asc(showcaseSymbols.symbol));
	return rows.map((r) => r.symbol);
}

/** The cached set, for filtering a list in one pass. */
export const showcasedSymbols = (): Promise<Set<string>> => showcaseSet();

/** For a guest, keep only the rows whose symbol is showcased; anyone else gets every row. */
export async function showcaseOnly<T extends { symbol: string }>(rows: T[], guest: boolean): Promise<T[]> {
	if (!guest) return rows;
	const set = await showcaseSet();
	return rows.filter((r) => set.has(normalizeShowcaseSymbol(r.symbol)));
}

export async function isSymbolShowcased(symbol: string): Promise<boolean> {
	const s = normalizeShowcaseSymbol(symbol);
	return s !== '' && (await showcaseSet()).has(s);
}

/** A thesis company is showcased when its listing symbol is. Unknown ids are not. */
export async function isCompanyShowcased(companyId: string): Promise<boolean> {
	if (!companyId) return false;
	const [row] = await db
		.select({ nseTicker: companies.nseTicker, bseTicker: companies.bseTicker })
		.from(companies)
		.where(eq(companies.companyId, companyId));
	const symbol = row ? priceSymbol(row) : null;
	return symbol ? isSymbolShowcased(symbol) : false;
}

/** A custom table is shown to guests when the thesis company it belongs to is. */
export async function isTableShowcased(tableId: number): Promise<boolean> {
	if (!Number.isSafeInteger(tableId) || tableId <= 0) return false;
	const [row] = await db
		.select({ companyId: customTables.companyId })
		.from(customTables)
		.where(eq(customTables.id, tableId));
	return row ? isCompanyShowcased(row.companyId) : false;
}

export async function setShowcase(symbol: string, on: boolean, adminId: number): Promise<void> {
	const s = normalizeShowcaseSymbol(symbol);
	if (!s) throw new Error('A symbol is required.');
	if (on) {
		await db.insert(showcaseSymbols).values({ symbol: s, addedBy: adminId }).onConflictDoNothing();
	} else {
		await db.delete(showcaseSymbols).where(eq(showcaseSymbols.symbol, s));
	}
	cache = null;
}
