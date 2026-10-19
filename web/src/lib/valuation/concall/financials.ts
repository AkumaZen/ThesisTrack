// Reads the Screener tables already stored for a tracked company (quarterly results, annual P&L,
// balance sheet, cash flow, ratios) into plain number series. Pure: no I/O. Accepts both table
// shapes the Master Tracker stores: the native scraper's `{ years, rows }` and the MCP server's
// `{ result: { data: { quarters | years, rows } } }`.

export interface Table {
	/** Period end (YYYY-MM-DD) per column; null for columns such as "TTM". */
	dates: (string | null)[];
	rows: Map<string, (number | null)[]>;
}

export interface Statements {
	quarterly?: Table;
	annual?: Table;
	balance?: Table;
	cashflow?: Table;
	ratios?: Table;
}

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

/** Last day of the month as YYYY-MM-DD. */
export function monthEnd(year: number, month: number): string {
	return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
}

/** "Jun 2026" or "2026-06-30" -> "2026-06-30"; anything else (TTM, blanks) -> null. */
export function periodDate(label: unknown): string | null {
	const text = String(label ?? '').trim();
	const iso = /^(\d{4})-(\d{2})-\d{2}$/.exec(text);
	if (iso) return monthEnd(+iso[1], +iso[2]);
	const m = /^([A-Za-z]{3})[a-z]*\.?\s+(\d{4})$/.exec(text);
	if (!m || !MONTHS[m[1].toLowerCase()]) return null;
	return monthEnd(+m[2], MONTHS[m[1].toLowerCase()]);
}

/** Shift a month-end date by whole months, staying on a month end. */
export function shiftMonths(date: string, months: number): string {
	const y = +date.slice(0, 4), m = +date.slice(5, 7);
	const total = y * 12 + (m - 1) + months;
	return monthEnd(Math.floor(total / 12), (total % 12) + 1);
}

export function parseNumber(value: unknown): number | null {
	if (typeof value === 'number') return Number.isFinite(value) ? value : null;
	const text = String(value ?? '').replace(/[,%\s]/g, '').replace(/^₹|^Rs\.?/i, '');
	if (!text || !/^-?\d*\.?\d+$/.test(text)) return null;
	return Number(text);
}

export const normaliseLabel = (label: string) => label.replace(/[+%]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();

function asObject(value: unknown): Record<string, unknown> | null {
	if (typeof value === 'string') {
		try { return asObject(JSON.parse(value)); } catch { return null; }
	}
	return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

export function parseTable(raw: unknown): Table | undefined {
	const root = asObject(raw);
	if (!root) return undefined;
	const body = asObject(asObject(root.result)?.data) ?? asObject(root.data) ?? root;
	const headers = [body.years, body.quarters, body.periods].find((h) => Array.isArray(h)) as unknown[] | undefined;
	const rows = body.rows;
	if (!headers || !Array.isArray(rows)) return undefined;
	const map = new Map<string, (number | null)[]>();
	for (const row of rows) {
		const r = asObject(row);
		if (!r || typeof r.label !== 'string' || !Array.isArray(r.values)) continue;
		const key = normaliseLabel(r.label);
		// Screener repeats a label for expandable sub-rows; the first occurrence is the statement line.
		if (!map.has(key)) map.set(key, headers.map((_, i) => parseNumber((r.values as unknown[])[i])));
	}
	return { dates: headers.map(periodDate), rows: map };
}

/** Statements from the stored Screener record (keys as in Research sources and the snapshot). */
export function statementsFrom(raw: Record<string, unknown>): Statements {
	return {
		quarterly: parseTable(raw.get_quarterly_results),
		annual: parseTable(raw.get_financials_profit_loss),
		balance: parseTable(raw.get_financials_balance_sheet),
		cashflow: parseTable(raw.get_financials_cash_flow),
		ratios: parseTable(raw.get_ratios)
	};
}

/** First row found among the aliases, as a date -> value lookup. */
export function series(table: Table | undefined, ...aliases: string[]): Map<string, number> {
	const out = new Map<string, number>();
	if (!table) return out;
	for (const alias of aliases) {
		const values = table.rows.get(alias);
		if (!values) continue;
		table.dates.forEach((d, i) => { if (d && values[i] != null) out.set(d, values[i]!); });
		break;
	}
	return out;
}

export const SALES = ['sales', 'revenue', 'total income'];
export const OPERATING_PROFIT = ['operating profit', 'financing profit', 'ebitda'];
export const NET_PROFIT = ['net profit', 'profit after tax', 'pat'];
