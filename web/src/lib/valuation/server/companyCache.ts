import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { companyCache } from '$lib/server/db/valuationSchema';
import { fetchCompanyFinancials, type CompanyFinancials } from './scraper';
import { fetchLtp } from './angelone';
import { bseSlugFor } from './screenerSlug';
import { isMarketOpenIST } from './marketHours';

const TTL_MS = 24 * 60 * 60 * 1000;

export async function getCompanyData(
	symbol: string
): Promise<{ data: CompanyFinancials; cacheHit: boolean }> {
	const key = symbol.toUpperCase();
	const [row] = await db.select().from(companyCache).where(eq(companyCache.symbol, key));

	// Freshness marker for schema growth: `sector` is the newest field added to
	// CompanyFinancials, and every field is set together in one `scrapeOnce()` return, so its
	// presence implies every earlier addition is present too. Bump this to whatever's newest
	// so stale cache rows self-heal instead of needing a manual wipe each time the shape grows.
	if (row && Date.now() - row.fetchedAt < TTL_MS && 'sector' in (row.data as object)) {
		return { data: row.data as CompanyFinancials, cacheHit: true };
	}

	const data = await fetchFinancials(key);
	await db
		.insert(companyCache)
		.values({ symbol: key, basis: data.basis, data, fetchedAt: Date.now() })
		.onConflictDoUpdate({
			target: companyCache.symbol,
			set: { basis: data.basis, data, fetchedAt: Date.now() }
		});

	return { data, cacheHit: false };
}

/**
 * Reads a company's statements from Screener under its ticker. Some companies are listed there
 * only by their BSE code (ASMTEC is /company/526433/), so a "not found" retries that page.
 */
async function fetchFinancials(symbol: string): Promise<CompanyFinancials> {
	try {
		return await fetchCompanyFinancials(symbol);
	} catch (e) {
		if (!(e instanceof Error) || !e.message.startsWith('NOT_FOUND')) throw e;
		const slug = await bseSlugFor(symbol).catch(() => null);
		if (!slug) throw e;
		// Keep the ticker the app knows the company by (prices and baskets use it).
		return { ...(await fetchCompanyFinancials(slug)), symbol };
	}
}

/** Manual, on-demand price refresh (button-triggered only — never polled) to conserve Angel One API calls. */
export async function refreshPrice(symbol: string): Promise<CompanyFinancials> {
	const key = symbol.toUpperCase();
	const [row] = await db.select().from(companyCache).where(eq(companyCache.symbol, key));
	if (!row) throw new Error('NOT_CACHED');

	// Outside NSE hours the price can't have moved since the last close already on record —
	// a live call would just re-fetch the same number Angel One already gave us. Skipping it
	// is a real reduction in wasted calls, not just a courtesy: this button gets clicked by
	// habit regardless of whether the market is actually open.
	if (!isMarketOpenIST()) {
		throw new Error('MARKET_CLOSED');
	}

	const price = await fetchLtp(key);
	if (price == null) throw new Error('PRICE_NOT_FOUND');

	const prev = row.data as CompanyFinancials;
	// Shares outstanding is implied from the last scrape (marketCap / cmp) and held fixed so the
	// refreshed market cap moves consistently with the live price rather than drifting separately.
	const impliedShares = prev.marketCap && prev.cmp ? prev.marketCap / prev.cmp : null;

	const data: CompanyFinancials = {
		...prev,
		cmp: price,
		marketCap:
			impliedShares != null ? Math.round(impliedShares * price * 100) / 100 : prev.marketCap,
		cmpFetchedAt: Date.now()
	};

	await db.update(companyCache).set({ data }).where(eq(companyCache.symbol, key));

	return data;
}
