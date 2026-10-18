/**
 * Business segment financials from Screener's segment table (/api/segments/<company id>/profit-loss/1/).
 * Pure parsing; the loader in server/segmentStore.ts fetches and stores it.
 *
 * Screener shows the segment NAMES to everyone but the numbers only to premium accounts. Without a
 * premium session the table carries a "upgrade to premium" cell instead of numbers, which is reported
 * as status 'premium' (names only) rather than as an empty table.
 */
import * as cheerio from 'cheerio';

/** Lines shown on the company page, in Screener's names. */
export const SEGMENT_LINES = ['Sales', 'Profit', 'Profit %', 'Capital Employed', 'ROCE %'] as const;

export interface SegmentTable {
	status: 'ok';
	consolidated: boolean;
	years: string[];
	/** Segment names, in Screener's order (the last rows may be "Unallocated" or "Less: Intersegment"). */
	segments: string[];
	/** Line name -> one row per segment -> one value per year (null where blank). */
	lines: Record<string, (number | null)[][]>;
}

export type SegmentData =
	| SegmentTable
	/** Names are visible but Screener withholds the numbers (premium-only). */
	| { status: 'premium'; consolidated: boolean; segments: string[] }
	/** The company reports no segments (or the table was not in a shape we understand). */
	| { status: 'none' };

const num = (text: string): number | null => {
	const cleaned = text.replace(/[,%\s]/g, '');
	if (cleaned === '' || cleaned === '-') return null;
	const n = Number(cleaned);
	return Number.isFinite(n) ? n : null;
};

/** The sentinel the loader stores when the table has no segment rows at all. */
export const NO_SEGMENTS: SegmentData = { status: 'none' };

export function parseSegmentHtml(html: string, consolidated: boolean): SegmentData {
	const $ = cheerio.load(html);
	const years = $('table.data-table thead th')
		.map((_, th) => $(th).text().trim())
		.get()
		.filter(Boolean);
	const bodies = $('tbody[data-segment-line]');
	if (bodies.length === 0) return NO_SEGMENTS;

	let segments: string[] = [];
	let premium = false;
	const lines: Record<string, (number | null)[][]> = {};
	let bad = false;
	bodies.each((_, body) => {
		const tbody = $(body);
		const line = tbody.attr('data-segment-line') ?? '';
		const topRow = tbody.children('tr').first();
		const cells = topRow.children('td');
		// First cell: a nested table whose first row is the line title and the rest are segment names.
		const names = cells
			.first()
			.find('td.text')
			.map((__, td) => $(td).text().trim())
			.get()
			.slice(1)
			.filter(Boolean);
		if (names.length > segments.length) segments = names;
		const valueCells = cells.slice(1);
		if (valueCells.toArray().some((c) => /premium/i.test($(c).text()))) {
			premium = true;
			return;
		}
		if (valueCells.length === 0 || names.length === 0) return;
		// One cell per year; each holds one number per segment, in the order of the names.
		const grid: (number | null)[][] = names.map(() => []);
		valueCells.each((__, cell) => {
			const tokens = $(cell)
				.text()
				.split(/\s+/)
				.filter(Boolean);
			if (tokens.length !== names.length) {
				bad = true;
				return;
			}
			tokens.forEach((t, i) => grid[i].push(num(t)));
		});
		lines[line] = grid;
	});

	if (segments.length === 0) return NO_SEGMENTS;
	if (premium) return { status: 'premium', consolidated, segments };
	if (bad || Object.keys(lines).length === 0 || years.length === 0) return NO_SEGMENTS;
	return { status: 'ok', consolidated, years, segments, lines };
}

/** Screener's company id and whether the page is the consolidated view, from the company page. */
export function parseCompanyInfo(html: string): { companyId: string; consolidated: boolean } | null {
	const $ = cheerio.load(html);
	const el = $('#company-info');
	const companyId = el.attr('data-company-id');
	if (!companyId) return null;
	return { companyId, consolidated: el.attr('data-consolidated') === 'true' };
}

/** Each segment's share of the latest year's sales, in percent (null when sales are missing or total zero). */
export function salesShares(t: SegmentTable): { segment: string; sales: number | null; sharePct: number | null }[] {
	const rows = t.lines['Sales'] ?? [];
	const last = (r: (number | null)[]) => r[r.length - 1] ?? null;
	// Rows such as "Less: Intersegment" are negative and would distort shares of the gross total.
	const positive = rows.map((r) => last(r)).filter((v): v is number => v != null && v > 0);
	const total = positive.reduce((a, b) => a + b, 0);
	return t.segments.map((segment, i) => {
		const sales = rows[i] ? last(rows[i]) : null;
		return { segment, sales, sharePct: sales != null && sales > 0 && total > 0 ? (sales / total) * 100 : null };
	});
}
