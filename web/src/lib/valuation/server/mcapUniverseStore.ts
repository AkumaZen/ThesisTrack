import { eq, sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { companyGrowthSeriesCache, mcapUniverse } from '$lib/server/db/valuationSchema';

/** One company of the scanner's market cap universe, as the scanner page needs it. */
export interface UniverseCompany {
	/** The app ticker; null when Angel One has no price source (or a shared ticker lost it). */
	symbol: string | null;
	name: string;
	marketCapCr: number;
	/** End of the six-month average period (YYYY-MM-DD). */
	asOf: string;
	/** 'No price source' companies are listed but never fetched. */
	noPriceSource: boolean;
}

/** Every active company of the list (loaded by scripts/import-mcap-universe.mjs). */
export async function listActiveUniverse(): Promise<UniverseCompany[]> {
	const rows = await db
		.select({
			symbol: mcapUniverse.symbol,
			name: mcapUniverse.companyName,
			marketCapCr: mcapUniverse.marketCapCr,
			asOf: mcapUniverse.mcapAsOf,
			status: mcapUniverse.priceSourceStatus
		})
		.from(mcapUniverse)
		.where(eq(mcapUniverse.active, true));
	return rows.map((r) => ({
		symbol: r.symbol,
		name: r.name,
		marketCapCr: Number(r.marketCapCr),
		asOf: r.asOf,
		noPriceSource: r.status === 'No price source'
	}));
}

/** Tickers of the active companies Angel One can price. */
export async function listUniverseSymbols(): Promise<string[]> {
	const rows = await db
		.select({ symbol: mcapUniverse.symbol })
		.from(mcapUniverse)
		.where(sql`${mcapUniverse.active} and ${mcapUniverse.symbol} is not null`);
	return rows.map((r) => r.symbol as string);
}

/** Active universe tickers with no stored price series at all: what "Load missing history" fetches. */
export async function listUniverseSymbolsWithoutSeries(): Promise<string[]> {
	const rows = await db
		.select({ symbol: mcapUniverse.symbol })
		.from(mcapUniverse)
		.where(
			sql`${mcapUniverse.active} and ${mcapUniverse.symbol} is not null and not exists (
				select 1 from ${companyGrowthSeriesCache} where ${companyGrowthSeriesCache.symbol} = ${mcapUniverse.symbol})`
		);
	return rows.map((r) => r.symbol as string).sort();
}

/** The subset of `symbols` that has any stored series (one query). */
export async function symbolsWithSeries(symbols: string[]): Promise<Set<string>> {
	if (symbols.length === 0) return new Set();
	const rows = await db.select({ symbol: companyGrowthSeriesCache.symbol }).from(companyGrowthSeriesCache);
	const wanted = new Set(symbols);
	return new Set(rows.map((r) => r.symbol.toUpperCase()).filter((s) => wanted.has(s)));
}
