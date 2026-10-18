import { not, like, sql, inArray } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { companyCache } from '$lib/server/db/valuationSchema';
import {
	computeFundamentalMetrics,
	type AnnualRow,
	type FundamentalMetrics,
	type ResultQuarter
} from '../fundamentals';
import { getStageScanUniverse } from './stageScanUniverse';

/** What the stored Screener record of one company gives the analytics pages. */
export interface StoredFinancials {
	symbol: string;
	name: string;
	industry: string | null;
	sector: string | null;
	roce: number | null;
	quarters: ResultQuarter[] | null;
	annual: AnnualRow[] | null;
}

/** Reads only the parts of each stored record that are needed (not the whole JSON). Compare-page
 *  statements are stored under STMT: keys; they are not company records. */
export async function readStoredFinancials(symbols?: string[]): Promise<StoredFinancials[]> {
	const rows = await db
		.select({
			symbol: companyCache.symbol,
			name: sql<string | null>`${companyCache.data}->>'name'`,
			industry: sql<string | null>`${companyCache.data}->>'industry'`,
			sector: sql<string | null>`${companyCache.data}->>'sector'`,
			roce: sql<string | null>`${companyCache.data}->>'roce'`,
			quarters: sql<ResultQuarter[] | null>`${companyCache.data}->'quarters'`,
			annual: sql<AnnualRow[] | null>`${companyCache.data}->'annual'`
		})
		.from(companyCache)
		.where(
			symbols
				? inArray(companyCache.symbol, symbols.map((s) => s.toUpperCase()))
				: not(like(companyCache.symbol, 'STMT:%'))
		);
	return rows.map((r) => ({
		symbol: r.symbol,
		name: r.name || r.symbol,
		industry: r.industry,
		sector: r.sector,
		roce: r.roce != null && Number.isFinite(Number(r.roce)) ? Number(r.roce) : null,
		quarters: r.quarters,
		annual: r.annual
	}));
}

/** Fundamental measures per symbol for the scanner's presets. */
export async function readFundamentalMetrics(symbols?: string[]): Promise<Map<string, FundamentalMetrics>> {
	const out = new Map<string, FundamentalMetrics>();
	for (const r of await readStoredFinancials(symbols)) {
		const m = computeFundamentalMetrics(r);
		if (m) out.set(r.symbol, m);
	}
	return out;
}

/** Scanner universe tickers whose stored Screener record lacks the yearly statements (or is absent):
 *  what "Load missing financials" fetches. Newest-first order is not needed; the list is stable. */
export async function symbolsMissingFinancials(): Promise<string[]> {
	const [universe, have] = await Promise.all([
		getStageScanUniverse(),
		db
			.select({ symbol: companyCache.symbol })
			.from(companyCache)
			.where(sql`jsonb_exists(${companyCache.data}, 'annual') and ${companyCache.symbol} not like 'STMT:%'`)
	]);
	const done = new Set(have.map((r) => r.symbol));
	return universe.filter((s) => !done.has(s));
}
