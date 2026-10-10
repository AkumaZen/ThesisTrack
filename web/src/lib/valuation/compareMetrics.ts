// Everything the Compare page knows about a metric: the statements shape the server sends, the
// default selection, friendly labels and the period alignment. Pure, so it runs on both sides.

export type SectionId = 'mkt' | 'val' | 'pl' | 'bs' | 'cf' | 'ratios' | 'sh';
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
	val: 'Valuation multiples',
	pl: 'Profit & loss',
	bs: 'Balance sheet',
	cf: 'Cash flow',
	ratios: 'Efficiency & returns',
	sh: 'Shareholding pattern'
};
export const SECTION_ORDER: SectionId[] = ['mkt', 'val', 'pl', 'bs', 'cf', 'ratios', 'sh'];

/** The selection a first visit (and "Reset to defaults") shows. */
export const DEFAULT_METRIC_KEYS: readonly string[] = [
	'mkt:Current Price',
	'mkt:Stock P/E',
	'val:P/E',
	'val:EV / EBITDA',
	'val:Price to book',
	'val:Price to sales',
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
	if (section === 'val' || (section === 'mkt' && /P\/E|EV \/|Price to/i.test(label))) return 'x';
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

/**
 * The metrics the table shows, in display order: statement order by default, or the order of
 * `selected` once the person has arranged the rows themselves. Selected keys that no loaded
 * company reports are skipped.
 */
export function shownMetrics(catalog: CatalogEntry[], selected: string[], arranged: boolean): CatalogEntry[] {
	if (!arranged) {
		const on = new Set(selected);
		return catalog.filter((m) => on.has(m.key));
	}
	const byKey = new Map(catalog.map((m) => [m.key, m]));
	return [...new Set(selected)].flatMap((k) => byKey.get(k) ?? []);
}

export interface MetricRun {
	/** Unique per run: a section can appear more than once in an arranged table. */
	id: string;
	section: SectionId;
	title: string;
	metrics: (CatalogEntry & { indent: boolean })[];
}

/**
 * Splits the shown metrics into runs of one section, each under its own header. A sub-row is
 * indented only when it follows its parent or a sibling, so it never looks part of another row.
 */
export function metricRuns(metrics: CatalogEntry[]): MetricRun[] {
	const runs: MetricRun[] = [];
	metrics.forEach((m, i) => {
		let run = runs[runs.length - 1];
		if (!run || run.section !== m.section) {
			run = { id: `${m.section}-${i}`, section: m.section, title: SECTION_TITLES[m.section], metrics: [] };
			runs.push(run);
		}
		const prev = run.metrics[run.metrics.length - 1];
		const indent =
			m.parent != null &&
			prev != null &&
			(prev.key === metricKey(m.section, m.parent) || (prev.parent === m.parent && prev.indent));
		run.metrics.push({ ...m, indent });
	});
	return runs;
}

/**
 * The selection after moving one shown metric to position `to` among the shown ones. Selected
 * keys that aren't shown (no loaded company has them) keep their slots between the others.
 */
export function moveMetric(selected: string[], shown: string[], from: number, to: number): string[] {
	const order = [...shown];
	const [key] = order.splice(from, 1);
	if (key === undefined) return selected;
	order.splice(Math.max(0, Math.min(to, order.length)), 0, key);
	// The shown keys' slots in the selection take the new order one by one, whatever order they
	// were stored in (a selection in statement order stores its keys in ticking order).
	const isShown = new Set(shown);
	let next = 0;
	return [...new Set(selected)].map((k) => (isShown.has(k) ? order[next++] : k));
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

/**
 * Whole numbers from 100 up (crore figures are large), up to two decimals below that, so small
 * amounts such as 0.45 Cr don't round to 0. Prices, ratios and percentages keep two decimals up to
 * 1,000. Anything that rounds to zero shows as "0", never "-0".
 */
export function formatValue(n: number | null, unit: Unit): string {
	if (n == null) return '—';
	const precise = unit === 'pct' || unit === 'rs' || unit === 'x';
	const digits = Math.abs(n) < (precise ? 1000 : 100) ? 2 : 0;
	const rounded = Math.round(n * 10 ** digits) / 10 ** digits || 0;
	const s = rounded.toLocaleString('en-IN', { maximumFractionDigits: digits });
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
