/** Quarter labels and growth maths shared by the preset scans, the fundamentals and the results table. Pure. */

export interface QuarterRow {
	label: string; // "Jun 2026"
	sales: number | null;
	netProfit: number | null;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** "Jun 2026" -> a running month number, or null when the label is not that shape. */
export function monthIndex(label: string): number | null {
	const m = /^([A-Za-z]{3})\w*\s+(\d{4})$/.exec(label.trim());
	if (!m) return null;
	const month = MONTHS.indexOf(m[1].toLowerCase());
	return month < 0 ? null : Number(m[2]) * 12 + month;
}

export function growthPct(now: number | null, then: number | null): number | null {
	if (now == null || then == null || !(then > 0)) return null;
	return (now / then - 1) * 100;
}

