/**
 * Aggregate quarterly earnings of a sector basket's members, from the quarterly results already
 * stored per company. Pure: it never fetches anything and never fills a gap.
 *
 * Each quarter sums only the members that have that quarter stored (and says how many). Year on
 * year growth is computed on the members that have BOTH the quarter and the same quarter a year
 * earlier, so a member reporting late or newly added cannot make growth look better or worse.
 */
import { growthPct, monthIndex, type QuarterRow } from './presetScans';

export interface EarningsQuarter {
	label: string;
	/** Sum over the members reporting this quarter, Rs crore. */
	sales: number;
	netProfit: number;
	/** Members with this quarter stored. */
	reporting: number;
	/** Year on year change in %, on the members that also have the quarter a year earlier. */
	salesYoY: number | null;
	profitYoY: number | null;
	/** Members behind the YoY figures (0 when the year-ago quarter is not stored for anyone). */
	yoyMembers: number;
}

export interface SectorEarnings {
	totalMembers: number;
	/** Members with at least one stored quarter. */
	coveredMembers: number;
	/** Oldest first. Empty when no member has quarterly results stored. */
	quarters: EarningsQuarter[];
}

/** Fewer than this share of members with results means the totals say little about the basket. */
export const THIN_COVERAGE = 0.5;

export const isThinCoverage = (e: SectorEarnings) =>
	e.totalMembers > 0 && e.coveredMembers / e.totalMembers < THIN_COVERAGE;

type Figures = { sales: number; netProfit: number };

export function aggregateSectorEarnings(
	byMember: Record<string, QuarterRow[] | null | undefined>,
	totalMembers: number,
	maxQuarters = 8
): SectorEarnings {
	// member -> quarter index -> figures. A quarter missing either figure does not count for that member.
	const tables: Map<number, Figures>[] = [];
	const labels = new Map<number, string>();
	for (const rows of Object.values(byMember)) {
		const table = new Map<number, Figures>();
		for (const r of rows ?? []) {
			const idx = monthIndex(r.label);
			if (idx == null || r.sales == null || r.netProfit == null) continue;
			table.set(idx, { sales: r.sales, netProfit: r.netProfit });
			if (!labels.has(idx)) labels.set(idx, r.label);
		}
		if (table.size > 0) tables.push(table);
	}

	const wanted = [...labels.keys()].sort((a, b) => a - b).slice(-maxQuarters);
	const quarters: EarningsQuarter[] = wanted.map((idx) => {
		let sales = 0;
		let netProfit = 0;
		let reporting = 0;
		let nowSales = 0;
		let nowProfit = 0;
		let thenSales = 0;
		let thenProfit = 0;
		let yoyMembers = 0;
		for (const t of tables) {
			const now = t.get(idx);
			if (!now) continue;
			reporting++;
			sales += now.sales;
			netProfit += now.netProfit;
			const then = t.get(idx - 12);
			if (!then) continue;
			yoyMembers++;
			nowSales += now.sales;
			nowProfit += now.netProfit;
			thenSales += then.sales;
			thenProfit += then.netProfit;
		}
		return {
			label: labels.get(idx) as string,
			sales,
			netProfit,
			reporting,
			salesYoY: yoyMembers > 0 ? growthPct(nowSales, thenSales) : null,
			profitYoY: yoyMembers > 0 ? growthPct(nowProfit, thenProfit) : null,
			yoyMembers
		};
	});

	return { totalMembers, coveredMembers: tables.length, quarters };
}
