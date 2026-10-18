import { eq } from 'drizzle-orm';
import { env } from '$env/dynamic/private';
import { db } from '$lib/server/db';
import { companySegments } from '$lib/server/db/valuationSchema';
import { parseCompanyInfo, parseSegmentHtml, type SegmentData } from '../segments';
import { politeFetch } from './scraper';

export interface StoredSegments {
	data: SegmentData;
	fetchedAt: number;
}

/** The stored segment table of a company, or null when it was never loaded. Page views use this only. */
export async function readSegments(symbol: string): Promise<StoredSegments | null> {
	const [row] = await db.select().from(companySegments).where(eq(companySegments.symbol, symbol.toUpperCase()));
	return row ? { data: row.data as SegmentData, fetchedAt: row.fetchedAt } : null;
}

/** Fetches the segment table from Screener (the company page for its id, then the segment endpoint) and
 *  stores it. With SCREENER_SESSION_ID set (a premium account's `sessionid` cookie) Screener returns the
 *  numbers; without it, only the segment names. */
export async function refreshSegments(symbol: string): Promise<StoredSegments> {
	const upper = symbol.toUpperCase();
	const cookie: Record<string, string> = env.SCREENER_SESSION_ID ? { Cookie: `sessionid=${env.SCREENER_SESSION_ID}` } : {};
	const page = await politeFetch(`https://www.screener.in/company/${encodeURIComponent(upper)}/consolidated/`, cookie);
	const info = parseCompanyInfo(page);
	if (!info) throw new Error('Screener page has no company id.');
	const query = info.consolidated ? '?consolidated=true' : '';
	const html = await politeFetch(`https://www.screener.in/api/segments/${info.companyId}/profit-loss/1/${query}`, {
		...cookie,
		'X-Requested-With': 'XMLHttpRequest'
	});
	const data = parseSegmentHtml(html, info.consolidated);
	const stored = { symbol: upper, data, fetchedAt: Date.now() };
	await db.insert(companySegments).values(stored).onConflictDoUpdate({ target: companySegments.symbol, set: stored });
	return { data, fetchedAt: stored.fetchedAt };
}
