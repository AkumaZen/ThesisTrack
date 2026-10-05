// Everything the Compare page knows about a metric: the statements shape the server sends, the
// default selection, friendly labels and the period alignment. Pure, so it runs on both sides.

export type SectionId = 'mkt' | 'pl' | 'bs' | 'cf' | 'ratios' | 'sh';
export type Unit = 'cr' | 'pct' | 'days' | 'rs' | 'count' | 'x';

export interface StatementRow {
	/** Stable id, e.g. `pl:Sales` or `bs:Other Assets>Trade receivables`. */
	key: string;
	label: string;
	/** The expandable Screener row this one sits under, if any. */
	parent: string | null;
	unit: Unit;
	/** One value per entry of the section's `labels`. */
	values: (number | null)[];
}

export interface StatementSection {
	id: SectionId;
	/** Period labels, oldest first, e.g. "Mar 2025". Empty for `mkt` (point-in-time figures). */
	labels: string[];
	rows: StatementRow[];
}

export interface CompareStatements {
	symbol: string;
	name: string;
	/** 'consolidated' unless Screener has no consolidated figures for the company. */
	basis: 'consolidated' | 'standalone_only';
	fetchedAt: number;
	sections: StatementSection[];
}

export const SECTION_TITLES: Record<SectionId, string> = {
	mkt: 'Market',
	pl: 'Profit & loss',
	bs: 'Balance sheet',
	cf: 'Cash flow',
	ratios: 'Efficiency & returns',
	sh: 'Shareholding pattern'
};
export const SECTION_ORDER: SectionId[] = ['mkt', 'pl', 'bs', 'cf', 'ratios', 'sh'];

/** The selection a first visit (and "Reset to defaults") shows. */
export const DEFAULT_METRIC_KEYS: readonly string[] = [
	'mkt:Current Price',
	'mkt:Stock P/E',
	'pl:Sales',
	'pl:OPM %',
	'pl:Net Profit',
	'pl:EPS in Rs',
	'bs:Reserves',
	'bs:Borrowings',
	'bs:Fixed Assets',
	'bs:CWIP',
	'bs:Other Assets>Trade receivables',
	'bs:Other Liabilities>Trade Payables',
	'bs:Other Assets>Inventories',
	'bs:Investments',
	'cf:Cash from Operating Activity',
	'cf:Cash from Investing Activity',
	'cf:Cash from Financing Activity',
	'cf:Net Cash Flow',
	'cf:Free Cash Flow',
	'cf:Cash from Operating Activity>Working capital changes',
	'ratios:Debtor Days',
	'ratios:Working Capital Days',
	'ratios:ROCE %',
	'sh:Promoters',
	'sh:FIIs',
	'sh:DIIs',
	'sh:Government',
	'sh:Public',
	'sh:No. of Shareholders'
];

/** Shorter, analyst-style names for the common rows; anything else keeps Screener's wording. */
const FRIENDLY: Record<string, string> = {
	'mkt:Current Price': 'CMP',
	'mkt:Stock P/E': 'P/E',
	'pl:Sales': 'Revenue',
	'pl:OPM %': 'OPM',
	'pl:Net Profit': 'PAT',
	'pl:EPS in Rs': 'EPS',
	'bs:Fixed Assets': 'Fixed assets',
	'bs:Other Assets>Trade receivables': 'Trade receivables',
	'bs:Other Liabilities>Trade Payables': 'Trade payables',
	'bs:Other Assets>Inventories': 'Inventory',
	'cf:Cash from Operating Activity': 'CFO (operating)',
	'cf:Cash from Investing Activity': 'CFI (investing)',
	'cf:Cash from Financing Activity': 'CFF (financing)',
	'cf:Net Cash Flow': 'Net cash flow',
	'cf:Free Cash Flow': 'Free cash flow',
	'cf:Cash from Operating Activity>Working capital changes': 'Working capital changes',
	'ratios:Debtor Days': 'Debtor (receivable) days',
	'ratios:Working Capital Days': 'Working capital days',
	'ratios:ROCE %': 'ROCE',
	'sh:No. of Shareholders': 'No. of shareholders'
};

export function metricLabel(key: string, fallback: string): string {
	return FRIENDLY[key] ?? fallback;
}

export function metricKey(section: SectionId, label: string, parent: string | null = null): string {
	return parent ? `${section}:${parent}>${label}` : `${section}:${label}`;
}

/** Unit for a row, from its label and whether Screener printed its cells with a % sign. */
export function unitFor(section: SectionId, label: string, sawPercent: boolean): Unit {
	if (sawPercent || /%/.test(label)) return 'pct';
	if (/days|cycle/i.test(label)) return 'days';
	if (/^No\. of/i.test(label)) return 'count';
	if (section === 'mkt' && /P\/E|P\/B/i.test(label)) return 'x';
	if (/EPS|Price|Book Value|Face Value|^High|^Low/i.test(label)) return 'rs';
	return 'cr';
}

export interface CatalogEntry {
	key: string;
	section: SectionId;
	label: string;
	parent: string | null;
	unit: Unit;
}

/**
 * Every metric seen across the loaded companies, in statement order (section, then the order
 * Screener lists rows, sub-rows right after their parent). A row only one company reports still
 * appears; the others show a dash.
 */
export function buildCatalog(companies: CompareStatements[]): CatalogEntry[] {
	const bySection = new Map<SectionId, CatalogEntry[]>();
	const seen = new Set<string>();
	for (const c of companies) {
		for (const s of c.sections) {
			const list = bySection.get(s.id) ?? [];
			for (const r of s.rows) {
				if (seen.has(r.key)) continue;
				seen.add(r.key);
				const entry: CatalogEntry = {
					key: r.key,
					section: s.id,
					label: metricLabel(r.key, r.label),
					parent: r.parent,
					unit: r.unit
				};
				// Keep a sub-row next to its parent even when only a later company has it.
				let at = list.length;
				if (r.parent) {
					const parentKey = metricKey(s.id, r.parent);
					const p = list.findIndex((e) => e.key === parentKey);
					if (p !== -1) {
						at = p + 1;
						while (at < list.length && list[at].parent === r.parent) at++;
					}
				}
				list.splice(at, 0, entry);
			}
			bySection.set(s.id, list);
		}
	}
	return SECTION_ORDER.flatMap((id) => bySection.get(id) ?? []);
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** "Mar 2026" -> a sortable month index (year * 12 + month), or null for anything else (e.g. TTM). */
export function periodIndex(label: string): number | null {
	const m = /^([A-Za-z]{3})[A-Za-z]*\s+(\d{4})$/.exec(label.trim());
	if (!m) return null;
	const month = MONTHS.indexOf(m[1].toLowerCase());
	return month === -1 ? null : Number(m[2]) * 12 + month;
}

/** The latest `count` completed financial years a company reports (oldest first, no TTM). */
export function yearColumns(company: CompareStatements, count: number): string[] {
	const pl = company.sections.find((s) => s.id === 'pl');
	const bs = company.sections.find((s) => s.id === 'bs');
	const labels = (pl?.labels.length ? pl.labels : bs?.labels) ?? [];
	return labels.filter((l) => periodIndex(l) != null).slice(-count);
}

/**
 * A metric's value for one year column. Annual sections match the year label exactly; the
 * quarterly shareholding table uses the latest quarter on or before that year end (within the
 * year), so each column shows who held the stock at that year end. Market figures are current.
 */
export function valueAt(company: CompareStatements, key: string, year: string): number | null {
	for (const s of company.sections) {
		const row = s.rows.find((r) => r.key === key);
		if (!row) continue;
		if (s.id === 'mkt') return row.values[0] ?? null;
		if (s.id !== 'sh') {
			const i = s.labels.indexOf(year);
			return i === -1 ? null : (row.values[i] ?? null);
		}
		const target = periodIndex(year);
		if (target == null) return null;
		let best = -1;
		s.labels.forEach((l, i) => {
			const p = periodIndex(l);
			if (p != null && p <= target && p > target - 12) best = i;
		});
		return best === -1 ? null : (row.values[best] ?? null);
	}
	return null;
}

export function formatValue(n: number | null, unit: Unit): string {
	if (n == null) return '—';
	const decimals = unit === 'pct' || unit === 'rs' || unit === 'x';
	const digits = decimals && Math.abs(n) < 1000 ? 2 : 0;
	const s = n.toLocaleString('en-IN', { maximumFractionDigits: digits });
	if (unit === 'pct') return `${s}%`;
	if (unit === 'rs') return `₹${s}`;
	if (unit === 'x') return `${s}x`;
	return s;
}

export const UNIT_HINT: Record<Unit, string> = {
	cr: '₹ Cr',
	pct: '%',
	days: 'days',
	rs: '₹',
	count: 'count',
	x: 'x'
};
