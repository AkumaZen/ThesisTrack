import { parseNseDay } from './insiderTrades';

// Pure helpers for NSE corporate actions: reading the exchange's rows (dividend, split, bonus,
// rights, buyback, ...), and the dividend history ratios (yield on the stored price, payout on
// Screener's EPS). No network or database in here.

export type ActionKind = 'dividend' | 'distribution' | 'split' | 'bonus' | 'rights' | 'buyback' | 'other';

export const ACTION_LABELS: Record<ActionKind, string> = {
	dividend: 'Dividend',
	distribution: 'Distribution',
	split: 'Split',
	bonus: 'Bonus',
	rights: 'Rights',
	buyback: 'Buyback',
	other: 'Other'
};

export interface ParsedAction {
	dedupeKey: string;
	nseSymbol: string;
	companyName: string;
	isin: string | null;
	kind: ActionKind;
	subject: string;
	/** Rupees per share: the dividend (regular plus special), or a rights premium. */
	amount: number | null;
	/** "1:10" for a bonus or rights issue, "10 to 2" (face value, Rs) for a split. */
	ratio: string | null;
	faceValue: number | null;
	exDate: string;
	recordDate: string | null;
}

const text = (v: unknown): string => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '');
const RUPEES = /\bR[se]s?\.?\s*(\d+(?:\.\d+)?)/gi;

/** Every "Rs 6.25" / "Re 0.50" / "Rs1.25" amount in the text. */
const rupeeAmounts = (s: string): number[] => [...s.matchAll(RUPEES)].map((m) => Number(m[1])).filter(Number.isFinite);

const round4 = (n: number) => Math.round(n * 10_000) / 10_000;

/** What kind of action a subject line describes, and its figures. */
export function classifyAction(subject: string): Pick<ParsedAction, 'kind' | 'amount' | 'ratio'> {
	const s = subject.trim();
	if (/^distribution\b/i.test(s)) {
		const first = rupeeAmounts(s)[0];
		return { kind: 'distribution', amount: first ?? null, ratio: null };
	}
	if (/\bsplit\b|sub-?division/i.test(s)) {
		const m = /from\s+R[se]s?\.?\s*(\d+(?:\.\d+)?).*?to\s+R[se]s?\.?\s*(\d+(?:\.\d+)?)/i.exec(s);
		return { kind: 'split', amount: null, ratio: m ? `${m[1]} to ${m[2]}` : null };
	}
	if (/\bbonus\b/i.test(s)) {
		const m = /(\d+)\s*:\s*(\d+)/.exec(s);
		return { kind: 'bonus', amount: null, ratio: m ? `${m[1]}:${m[2]}` : null };
	}
	if (/\brights?\b/i.test(s)) {
		const m = /(\d+)\s*:\s*(\d+)/.exec(s);
		const premium = /premium\s+R[se]s?\.?\s*(\d+(?:\.\d+)?)/i.exec(s);
		return { kind: 'rights', amount: premium ? Number(premium[1]) : null, ratio: m ? `${m[1]}:${m[2]}` : null };
	}
	if (/buy\s*-?back/i.test(s)) return { kind: 'buyback', amount: null, ratio: null };
	if (/dividend/i.test(s)) {
		const amounts = rupeeAmounts(s);
		return { kind: 'dividend', amount: amounts.length ? round4(amounts.reduce((a, b) => a + b, 0)) : null, ratio: null };
	}
	return { kind: 'other', amount: null, ratio: null };
}

// Government securities and bond interest payments share the feed; they are not equity actions.
const SKIP_SERIES = new Set(['GS', 'TB', 'SG', 'RR', 'N1', 'N2', 'N3', 'N4', 'N5', 'N6', 'N7', 'N8', 'N9', 'NA', 'NB', 'NC']);

export function parseCorporateActions(payload: unknown): ParsedAction[] {
	const rows = Array.isArray(payload) ? payload : (payload as { data?: unknown } | null)?.data;
	if (!Array.isArray(rows)) return [];
	const out: ParsedAction[] = [];
	for (const row of rows) {
		if (!row || typeof row !== 'object') continue;
		const r = row as Record<string, unknown>;
		const nseSymbol = text(r.symbol).toUpperCase();
		const subject = text(r.subject);
		const exDate = parseNseDay(r.exDate) ?? parseNseDay(r.recDate);
		if (!nseSymbol || !subject || !exDate) continue;
		if (SKIP_SERIES.has(text(r.series).toUpperCase()) || /^interest payment/i.test(subject)) continue;
		const faceValue = Number(text(r.faceVal));
		out.push({
			dedupeKey: `ca:${nseSymbol}|${exDate}|${subject.toLowerCase()}`,
			nseSymbol,
			companyName: text(r.comp) || nseSymbol,
			isin: text(r.isin) || null,
			...classifyAction(subject),
			subject,
			faceValue: Number.isFinite(faceValue) && faceValue > 0 ? faceValue : null,
			exDate,
			recordDate: parseNseDay(r.recDate)
		});
	}
	return out;
}

// ---- dividend history ratios ----

export interface DividendRow {
	exDate: string;
	kind: string;
	amount: number | null;
}

export interface FiscalDividend {
	/** "FY2026" is April 2025 to March 2026, by ex-date. */
	fy: string;
	perShare: number;
	eps: number | null;
	payoutPct: number | null;
}

export interface DividendStats {
	/** Per-share dividends with an ex-date in the 12 months to `asOf`. */
	ttmPerShare: number;
	/** Percent of the stored price; null without a price. */
	yieldPct: number | null;
	last: { exDate: string; amount: number } | null;
	years: FiscalDividend[];
}

const fyOf = (day: string): number => {
	const year = Number(day.slice(0, 4));
	return Number(day.slice(5, 7)) >= 4 ? year + 1 : year;
};

const addYears = (day: string, n: number) => `${Number(day.slice(0, 4)) + n}${day.slice(4)}`;

/** Screener labels years "Mar 2025"; the matching fiscal year is 2025. */
const labelYear = (label: string): number | null => {
	const m = /(\d{4})\s*$/.exec(label);
	return m ? Number(m[1]) : null;
};

export function dividendStats(
	actions: DividendRow[],
	price: number | null,
	asOf: string,
	epsByYear: { label: string; eps: number | null }[] = []
): DividendStats {
	const paid = actions
		.filter((a): a is DividendRow & { amount: number } => a.kind === 'dividend' && a.amount != null && a.amount > 0 && a.exDate <= asOf)
		.sort((a, b) => b.exDate.localeCompare(a.exDate));
	const since = addYears(asOf, -1);
	const ttmPerShare = round4(paid.filter((a) => a.exDate > since).reduce((sum, a) => sum + a.amount, 0));
	const byFy = new Map<number, number>();
	for (const a of paid) byFy.set(fyOf(a.exDate), (byFy.get(fyOf(a.exDate)) ?? 0) + a.amount);
	const eps = new Map<number, number | null>();
	for (const e of epsByYear) {
		const y = labelYear(e.label);
		if (y != null) eps.set(y, e.eps);
	}
	const years = [...byFy.entries()]
		.sort((a, b) => b[0] - a[0])
		.slice(0, 6)
		.map(([fy, total]): FiscalDividend => {
			const e = eps.get(fy) ?? null;
			return { fy: `FY${fy}`, perShare: round4(total), eps: e, payoutPct: e != null && e > 0 ? Math.round((total / e) * 1000) / 10 : null };
		});
	return {
		ttmPerShare,
		yieldPct: price != null && price > 0 && ttmPerShare > 0 ? Math.round((ttmPerShare / price) * 10_000) / 100 : null,
		last: paid[0] ? { exDate: paid[0].exDate, amount: paid[0].amount } : null,
		years
	};
}

// ---- upcoming list ----

export const UPCOMING_PAGE_SIZE = 50;

export function actionSummary(a: { kind: string; amount: number | null; ratio: string | null; subject: string }): string {
	if (a.kind === 'dividend' && a.amount != null) return `Dividend Rs ${a.amount} per share`;
	if (a.kind === 'bonus' && a.ratio) return `Bonus ${a.ratio}`;
	if (a.kind === 'split' && a.ratio) return `Split, face value Rs ${a.ratio.replace(' to ', ' to Rs ')}`;
	if (a.kind === 'rights' && a.ratio) return `Rights ${a.ratio}${a.amount != null ? ` at premium Rs ${a.amount}` : ''}`;
	return a.subject;
}
