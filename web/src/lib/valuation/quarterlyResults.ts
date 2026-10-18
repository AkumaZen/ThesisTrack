/**
 * The quarterly results table: for each company its latest reported quarter against the quarter a
 * year earlier (YoY) and the quarter before (QoQ), from the Screener quarters stored per company.
 * Pure: no database, no network. A comparison that cannot be made (no such quarter, or a base that
 * is zero or negative) is null, never a guess.
 */
import { growthPct, monthIndex } from './quarters';
import type { ResultQuarter } from './fundamentals';

export interface ResultsRow {
	symbol: string;
	name: string;
	industry: string | null;
	sector: string | null;
	/** Sector baskets the company sits in. */
	baskets: string[];
	/** Latest quarter, e.g. "Jun 2026". */
	quarter: string;
	/** Month number of the quarter, to sort recent results first. */
	quarterIndex: number;
	/** Rs crore. */
	sales: number | null;
	salesYoY: number | null;
	salesQoQ: number | null;
	netProfit: number | null;
	profitYoY: number | null;
	profitQoQ: number | null;
	/** Operating margin (EBITDA margin) in %. */
	opm: number | null;
	/** Change in operating margin vs a year earlier / the quarter before, percentage points. */
	opmYoYPp: number | null;
	opmQoQPp: number | null;
}

export interface ResultsCompany {
	symbol: string;
	name: string;
	industry: string | null;
	sector: string | null;
	baskets: string[];
	quarters: ResultQuarter[] | null | undefined;
}

const diff = (now: number | null | undefined, then: number | null | undefined) =>
	now == null || then == null ? null : now - then;

/** One row for the company's latest quarter; null when it has no quarters with a readable label. */
export function buildResultsRow(c: ResultsCompany): ResultsRow | null {
	const labelled = (c.quarters ?? []).filter((q) => monthIndex(q.label) != null);
	const now = labelled[labelled.length - 1];
	if (!now) return null;
	const at = monthIndex(now.label) as number;
	const yearAgo = labelled.find((q) => monthIndex(q.label) === at - 12);
	const prev = labelled.find((q) => monthIndex(q.label) === at - 3);
	return {
		symbol: c.symbol,
		name: c.name,
		industry: c.industry,
		sector: c.sector,
		baskets: c.baskets,
		quarter: now.label,
		quarterIndex: at,
		sales: now.sales,
		salesYoY: yearAgo ? growthPct(now.sales, yearAgo.sales) : null,
		salesQoQ: prev ? growthPct(now.sales, prev.sales) : null,
		netProfit: now.netProfit,
		profitYoY: yearAgo ? growthPct(now.netProfit, yearAgo.netProfit) : null,
		profitQoQ: prev ? growthPct(now.netProfit, prev.netProfit) : null,
		opm: now.opmPct,
		opmYoYPp: yearAgo ? diff(now.opmPct, yearAgo.opmPct) : null,
		opmQoQPp: prev ? diff(now.opmPct, prev.opmPct) : null
	};
}

export interface ResultsFilters {
	query: string;
	/** An industry name, or '' for every industry. */
	industry: string;
	/** A sector basket label, or '' for every basket. */
	basket: string;
	/** Only these symbols (a watchlist); null for no restriction. */
	symbols: Set<string> | null;
	/** A quarter label, or '' for every quarter. */
	quarter: string;
}

export function filterResults(rows: ResultsRow[], f: ResultsFilters): ResultsRow[] {
	const q = f.query.trim().toLowerCase();
	return rows.filter(
		(r) =>
			(!q || r.symbol.toLowerCase().includes(q) || r.name.toLowerCase().includes(q)) &&
			(!f.industry || r.industry === f.industry) &&
			(!f.basket || r.baskets.includes(f.basket)) &&
			(!f.symbols || f.symbols.has(r.symbol)) &&
			(!f.quarter || r.quarter === f.quarter)
	);
}

export type ResultsSortKey =
	| 'name'
	| 'quarter'
	| 'sales'
	| 'salesYoY'
	| 'salesQoQ'
	| 'netProfit'
	| 'profitYoY'
	| 'profitQoQ'
	| 'opm'
	| 'opmYoYPp'
	| 'opmQoQPp';

/** Sorted copy. Blank values always go last, whichever way the column is sorted. */
export function sortResults(rows: ResultsRow[], key: ResultsSortKey, dir: 1 | -1): ResultsRow[] {
	const value = (r: ResultsRow): string | number | null => (key === 'quarter' ? r.quarterIndex : r[key]);
	return [...rows].sort((a, b) => {
		const va = value(a);
		const vb = value(b);
		if (va == null && vb == null) return a.symbol.localeCompare(b.symbol);
		if (va == null) return 1;
		if (vb == null) return -1;
		const c = typeof va === 'string' ? va.localeCompare(vb as string) : va - (vb as number);
		return c * dir || a.symbol.localeCompare(b.symbol);
	});
}

/** Distinct quarters, most recent first, each with how many companies reported it. */
export function quarterOptions(rows: ResultsRow[]): { label: string; count: number }[] {
	const seen = new Map<string, { index: number; count: number }>();
	for (const r of rows) {
		const s = seen.get(r.quarter);
		if (s) s.count++;
		else seen.set(r.quarter, { index: r.quarterIndex, count: 1 });
	}
	return [...seen.entries()].sort((a, b) => b[1].index - a[1].index).map(([label, s]) => ({ label, count: s.count }));
}
