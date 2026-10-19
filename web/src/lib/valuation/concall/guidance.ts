// Guidance statements pulled from concalls, and the rule-based check against later reported
// numbers. The model only extracts the statement; kept / missed / pending is decided here from the
// stored quarterly results, so it can be re-run for free whenever new results arrive.

import { NET_PROFIT, OPERATING_PROFIT, SALES, series, shiftMonths, type Table } from './financials';

export const GUIDANCE_METRICS = ['revenue', 'ebitda', 'ebitda_margin', 'pat', 'other'] as const;
export type GuidanceMetric = (typeof GUIDANCE_METRICS)[number];
export const GUIDANCE_BASES = ['growth_pct', 'level', 'margin_pct', 'margin_change_pp'] as const;
export type GuidanceBasis = (typeof GUIDANCE_BASES)[number];
export const COMPARATORS = ['at_least', 'at_most', 'approx', 'between'] as const;
export type Comparator = (typeof COMPARATORS)[number];

export interface GuidanceStatement {
	metric: GuidanceMetric;
	/** Short name; for "other" metrics this is the only description of what was guided. */
	label: string;
	basis: GuidanceBasis;
	comparator: Comparator;
	target: number | null;
	targetHigh: number | null;
	/** "FY27", "Q2 FY27" or "H1 FY27". */
	period: string;
	quote: string;
}

export type GuidanceStatus = 'kept' | 'missed' | 'pending' | 'unverified';
export interface GuidanceEvaluation { status: GuidanceStatus; actual: number | null; actualText: string; reason: string }

/** Levels (Rs Cr) may be off by this fraction either way and still count; percentages by TOLERANCE_PP points. */
export const TOLERANCE_REL = 0.05;
export const TOLERANCE_PP = 1;
/** A margin change target ("expand by 3-4 points") is itself small, so it gets a tighter tolerance. */
export const TOLERANCE_CHANGE_PP = 0.5;

/** Quarter-end dates covered by a period label, or null when the label is not understood. */
export function periodQuarters(period: string): string[] | null {
	const text = period.toUpperCase().replace(/\s+/g, '');
	const fyYear = (digits: string) => (digits.length === 2 ? 2000 + +digits : +digits);
	const end = (year: number, month: number) => shiftMonths(`${year}-03-31`, month - 3);
	let m = /^(?:Q([1-4]))FY(\d{2}|\d{4})$/.exec(text);
	if (m) return [shiftMonths(`${fyYear(m[2])}-03-31`, -12 + 3 * +m[1])];
	m = /^H([12])FY(\d{2}|\d{4})$/.exec(text);
	if (m) { const y = fyYear(m[2]); return m[1] === '1' ? [end(y - 1, 6), end(y - 1, 9)] : [end(y - 1, 12), end(y, 3)]; }
	m = /^FY(\d{2}|\d{4})$/.exec(text) ?? /^FY\d{2,4}-(\d{2})$/.exec(text);
	if (m) { const y = fyYear(m[1]); return [end(y - 1, 6), end(y - 1, 9), end(y - 1, 12), end(y, 3)]; }
	return null;
}

function aggregate(metric: GuidanceMetric, quarters: string[], q: Table | undefined): { value: number; sales: number } | null {
	const sales = series(q, ...SALES), op = series(q, ...OPERATING_PROFIT), pat = series(q, ...NET_PROFIT);
	const pick = metric === 'revenue' ? sales : metric === 'pat' ? pat : op;
	if (quarters.some((d) => !pick.has(d) || !sales.has(d))) return null;
	const sum = (m: Map<string, number>) => quarters.reduce((n, d) => n + m.get(d)!, 0);
	return { value: sum(pick), sales: sum(sales) };
}

const num = (n: number) => (Math.abs(n) >= 100 ? n.toFixed(0) : n.toFixed(1));

function meets(g: GuidanceStatement, actual: number): boolean {
	const points = g.basis === 'margin_change_pp' ? TOLERANCE_CHANGE_PP : TOLERANCE_PP;
	const percent = g.basis !== 'level';
	const low = (v: number) => (percent ? v - points : v * (1 - TOLERANCE_REL));
	const high = (v: number) => (percent ? v + points : v * (1 + TOLERANCE_REL));
	const t = g.target!;
	switch (g.comparator) {
		case 'at_least': return actual >= low(t);
		case 'at_most': return actual <= high(t);
		case 'approx': return actual >= low(t) && actual <= high(t);
		case 'between': return actual >= low(Math.min(t, g.targetHigh ?? t)) && actual <= high(Math.max(t, g.targetHigh ?? t));
	}
}

export function evaluateGuidance(g: GuidanceStatement, quarterly: Table | undefined): GuidanceEvaluation {
	const unverified = (reason: string): GuidanceEvaluation => ({ status: 'unverified', actual: null, actualText: '', reason });
	if (g.metric === 'other') return unverified('This metric is not in the stored financials.');
	if (g.target == null) return unverified('The statement has no numeric target.');
	if (g.comparator === 'between' && g.targetHigh == null) return unverified('The range has no upper bound.');
	if ((g.metric === 'ebitda_margin') !== (g.basis === 'margin_pct' || g.basis === 'margin_change_pp')) return unverified('The metric and the way the target is stated do not match.');
	const quarters = periodQuarters(g.period);
	if (!quarters) return unverified(`The period "${g.period}" is not understood.`);

	const dates = (quarterly?.dates.filter((d): d is string => !!d) ?? []).sort();
	const latest = dates.at(-1);
	if (!latest || quarters[quarters.length - 1] > latest) return { status: 'pending', actual: null, actualText: '', reason: 'The period has not been reported yet.' };

	const now = aggregate(g.metric === 'ebitda_margin' ? 'ebitda' : g.metric, quarters, quarterly);
	if (!now) return unverified('The stored results do not cover this period.');
	let actual: number, actualText: string;
	if (g.basis === 'level') {
		actual = now.value; actualText = `Rs ${num(actual)} Cr`;
	} else if (g.basis === 'margin_pct') {
		if (now.sales <= 0) return unverified('Sales for the period are not positive.');
		actual = (now.value / now.sales) * 100; actualText = `${num(actual)}% margin`;
	} else if (g.basis === 'margin_change_pp') {
		// "Margin expansion of 3-4%" is a change against the same period a year ago, not a margin level.
		const before = aggregate('ebitda', quarters.map((d) => shiftMonths(d, -12)), quarterly);
		if (!before || before.sales <= 0 || now.sales <= 0) return unverified('The year-ago period is missing or has no sales, so the margin change cannot be measured.');
		actual = (now.value / now.sales - before.value / before.sales) * 100;
		actualText = `${actual >= 0 ? '+' : ''}${num(actual)} pts margin change`;
	} else {
		const before = aggregate(g.metric, quarters.map((d) => shiftMonths(d, -12)), quarterly);
		if (!before || before.value <= 0) return unverified('The year-ago period is missing or not positive, so growth cannot be measured.');
		actual = ((now.value - before.value) / before.value) * 100; actualText = `${num(actual)}% growth`;
	}
	const ok = meets(g, actual);
	return { status: ok ? 'kept' : 'missed', actual, actualText, reason: `Reported ${actualText} for ${g.period}.` };
}

/** Share of resolved (kept or missed) statements that were kept; null until something resolves. */
export function credibility(items: { status: string }[]): { kept: number; resolved: number; pct: number | null } {
	const kept = items.filter((i) => i.status === 'kept').length;
	const resolved = kept + items.filter((i) => i.status === 'missed').length;
	return { kept, resolved, pct: resolved ? Math.round((kept / resolved) * 100) : null };
}

const WORDS: Record<string, string> = { at_least: 'at least', at_most: 'at most', approx: 'about', between: 'between' };
const UNITS: Record<string, string> = { growth_pct: '% growth', level: ' Rs Cr', margin_pct: '% margin', margin_change_pp: ' pts margin change' };

/** "at least 15% growth in Q1 FY27", for display next to the quote. */
export function describeTarget(g: { basis: string; comparator: string; target: number | null; targetHigh: number | null; period: string }): string {
	if (g.target == null) return g.period;
	const unit = UNITS[g.basis] ?? '';
	const plain = (n: number) => String(Math.round(n * 10) / 10);
	const range = g.comparator === 'between' && g.targetHigh != null ? `${plain(g.target)} and ${plain(g.targetHigh)}${unit}` : `${plain(g.target)}${unit}`;
	return `${WORDS[g.comparator] ?? ''} ${range} in ${g.period}`.trim();
}
