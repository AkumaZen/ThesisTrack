import { inArray, sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { companyCache } from '$lib/server/db/valuationSchema';
import type { QuarterRow } from '../presetScans';
import { aggregateSectorEarnings, type SectorEarnings } from '../sectorEarnings';

/** Aggregate quarterly revenue and net profit of a basket's members from the Screener results
 *  already stored (valuation.company_cache). Reads only the `quarters` part of each record; never
 *  scrapes. A member nobody has opened has nothing stored and shows up as not covered. */
export async function getSectorEarnings(symbols: string[]): Promise<SectorEarnings> {
	const members = [...new Set(symbols.map((s) => s.toUpperCase()))];
	if (members.length === 0) return aggregateSectorEarnings({}, 0);
	const rows = await db
		.select({ symbol: companyCache.symbol, quarters: sql<QuarterRow[] | null>`${companyCache.data}->'quarters'` })
		.from(companyCache)
		.where(inArray(companyCache.symbol, members));
	return aggregateSectorEarnings(Object.fromEntries(rows.map((r) => [r.symbol, r.quarters])), members.length);
}
