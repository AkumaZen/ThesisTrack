import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { sparklineCache } from '$lib/server/db/valuationSchema';
import { readCachedCloses } from './companyGrowthSeries';
import { angelListings } from './angelone';

// The watchlist's Trend column reads the prices already STORED for the company (the same series
// the sector pages use), never Angel One: a page view must not queue behind the rate limiter or
// run into the serverless time limit, which is how trends used to go missing silently for rows
// further down a long watchlist. Stored prices are filled by the scheduled refresh (which now
// includes every watchlist company) or by someone pressing Refresh.

/** Sessions shown in the sparkline: about the last 90 calendar days. */
export const SPARKLINE_SESSIONS = 62;

export type SparklineResult =
	| { kind: 'ok'; closes: number[]; fetchedAt: number }
	/** Nothing stored yet; Angel One lists the company (or it could not be checked), so a refresh can fill it. */
	| { kind: 'not_stored' }
	/** Angel One has no listing for this symbol, so there will never be a price series. */
	| { kind: 'unlisted' };

/** The last ~90 days of a stored close series, dropping anything that is not a usable price. */
export function sparklineTail(closes: number[]): number[] {
	return closes.filter((c) => Number.isFinite(c) && c > 0).slice(-SPARKLINE_SESSIONS);
}

/** Decides what the Trend cell can show, given what is stored and whether Angel One lists the
 *  symbol (null = could not be checked in time). Pure so every state is testable. */
export function classifySparkline(
	stored: { closes: number[]; fetchedAt: number } | null,
	listed: boolean | null,
	/** Closes the old live route saved (sparkline_cache), used when the growth series has none. */
	legacy: { closes: number[]; fetchedAt: number } | null = null
): SparklineResult {
	for (const source of [stored, legacy]) {
		const closes = source ? sparklineTail(source.closes) : [];
		if (source && closes.length >= 2) return { kind: 'ok', closes, fetchedAt: source.fetchedAt };
	}
	return listed === false ? { kind: 'unlisted' } : { kind: 'not_stored' };
}

export async function getSparkline(symbol: string): Promise<SparklineResult> {
	const key = symbol.toUpperCase();
	const stored = (await readCachedCloses([key])).get(key) ?? null;
	if (stored && sparklineTail(stored.closes).length >= 2) return classifySparkline(stored, true);
	// Closes saved by the old live route still count, at any age (no Angel One call).
	const [row] = await db.select().from(sparklineCache).where(eq(sparklineCache.symbol, key));
	const legacy = row ? { closes: row.closes, fetchedAt: row.fetchedAt } : null;
	if (legacy && sparklineTail(legacy.closes).length >= 2) return classifySparkline(stored, true, legacy);
	// Nothing usable stored: tell "will never have prices" from "not fetched yet". The instrument
	// list is a public file, not an Angel One API call, and is skipped if it is slow to load.
	const listings = await angelListings([key]).catch(() => null);
	return classifySparkline(stored, listings?.get(key) ?? null);
}
