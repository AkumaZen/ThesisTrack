/**
 * Whole-market "% below 50 DMA": the share of NSE equities closing under their own 50 session
 * average, per day. Pure rules only (no network, no database): the stores feed in each symbol's
 * stored closes and the daily quotes.
 *
 * Days are epoch days (whole days since 1970-01-01, UTC) so a symbol's history is two small arrays.
 * A symbol counts on a day only with at least 50 of its own closes up to and including that day
 * (200 for the 200 DMA). Holidays and suspensions simply have no close, so the average runs over the
 * symbol's own sessions and a day it did not trade is not counted for it.
 */
import { isWeekend } from './server/refreshMerge';

export const DMA_SHORT = 50;
export const DMA_LONG = 200;
/** First day of fetched history: gives the 200 DMA a full warmup before the chart starts. */
export const HISTORY_FROM = '2024-03-01';
/** First day the chart and the stored aggregate cover (50 sessions of warmup come before it). */
export const CHART_FROM = '2025-04-01';
/** A day with fewer eligible stocks than this is too thin to publish (only ever a data fault). */
export const MIN_ELIGIBLE = 100;

const DAY_MS = 86_400_000;
export const isoToDay = (iso: string): number => Math.floor(Date.parse(`${iso.slice(0, 10)}T00:00:00Z`) / DAY_MS);
export const dayToIso = (day: number): string => new Date(day * DAY_MS).toISOString().slice(0, 10);

export interface DmaRow {
	day: number;
	eligible50: number;
	below50: number;
	eligible200: number;
	below200: number;
}

/** Adds one symbol's readings into the per-day rows for every day from `sinceDay` on. Rolling sums
 *  keep it linear. A close exactly on its average is not below it. */
export function addSymbolDma(rows: Map<number, DmaRow>, days: number[], closes: number[], sinceDay: number): void {
	const n = Math.min(days.length, closes.length);
	let sum50 = 0;
	let sum200 = 0;
	for (let i = 0; i < n; i++) {
		sum50 += closes[i];
		sum200 += closes[i];
		if (i >= DMA_SHORT) sum50 -= closes[i - DMA_SHORT];
		if (i >= DMA_LONG) sum200 -= closes[i - DMA_LONG];
		if (days[i] < sinceDay) continue;
		let row = rows.get(days[i]);
		if (!row) rows.set(days[i], (row = { day: days[i], eligible50: 0, below50: 0, eligible200: 0, below200: 0 }));
		if (i + 1 >= DMA_SHORT) {
			row.eligible50++;
			if (closes[i] < sum50 / DMA_SHORT) row.below50++;
		}
		if (i + 1 >= DMA_LONG) {
			row.eligible200++;
			if (closes[i] < sum200 / DMA_LONG) row.below200++;
		}
	}
}

/** Percent of `part` in `whole`, null when nothing was eligible. */
export const pctOf = (part: number, whole: number): number | null => (whole > 0 ? (part / whole) * 100 : null);

/** The rows worth storing, oldest first: those with enough eligible stocks. */
export const publishableRows = (rows: Map<number, DmaRow>): DmaRow[] =>
	[...rows.values()].filter((r) => r.eligible50 >= MIN_ELIGIBLE).sort((a, b) => a.day - b.day);

// ---- Universe ----

/** Exchange-traded funds and other fund units trade in the EQ series too. The scrip master has no
 *  flag for them, so they are told apart by name. The patterns come from the NSE list: ETF/BeES/IETF
 *  suffixes, liquid and gilt funds, index and commodity trackers (NIFTY..., GOLD/SILVER with a fund
 *  suffix) and the "ADD"/"BETA"/"CASE" unit names. Bank and company names that merely contain such
 *  words (YESBANK, GOLDIAM, SUNPHARMA) are kept. */
const FUND_NAME =
	/ETF|BEES|IETF|LIQUID|LIQ[A-Z]*BEES|GILT|GSEC|SDL$|NIFTY|SENSEX|(GOLD|SILVER|NEXT50|MID150|MIDCAP|SMALLCAP|PSUBK|PSUBNK|SMALL|MOMENTUM|MOM|LOWVOL|QUAL|TOP\d+|BSE500|NV20|NXT100|SML100|NIF\d+)(ADD|BETA|CASE|BND|AXIS|\d*)$|^(GOLD|SILVER|LIQUID|NIFTY|SENSEX|ALPHA|NEXT50|MID150|NV20|NETF|MOM\d+)\d*$|CASE$|BETA$|ADD$|CASHIETF|[A-Z]BANKIETF|^(BANK|PSUBANK|PVTBANK)(ADD|BETA|CASE|BEES|ETF|IETF)?$/;

export function isFundName(name: string): boolean {
	const n = name.toUpperCase();
	// Real companies that happen to end in a fund-like suffix.
	if (/^(SHRADDHA|ALPHAGEO|MANCREDIT|BALPHARMA|ADDIND|LADDERUP)$/.test(n)) return false;
	return FUND_NAME.test(n);
}

export interface UniverseScrip {
	symbol: string;
	token: string;
	exch: string;
}

/** The universe: one NSE listing per name, EQ preferred over BE (trade-to-trade), funds removed.
 *  SM (SME board), BZ, REIT/InvIT (RR/IV), debt, gold bonds and indices are not equities for this
 *  purpose and are left out. `entries` are rows of Angel One's scrip master. */
export function buildBreadthUniverse(
	entries: { token: string; symbol: string; name: string; exch_seg: string }[]
): UniverseScrip[] {
	const byName = new Map<string, { entry: (typeof entries)[number]; rank: number }>();
	for (const e of entries) {
		if (e.exch_seg !== 'NSE') continue;
		const series = e.symbol.endsWith('-EQ') ? 0 : e.symbol.endsWith('-BE') ? 1 : -1;
		if (series < 0) continue;
		const name = e.name.toUpperCase();
		if (isFundName(name) || /NSETEST$/.test(name)) continue; // funds and the exchange's test symbols
		const cur = byName.get(name);
		if (!cur || series < cur.rank) byName.set(name, { entry: e, rank: series });
	}
	return [...byName.entries()]
		.map(([symbol, { entry }]) => ({ symbol, token: entry.token, exch: entry.exch_seg }))
		.sort((a, b) => a.symbol.localeCompare(b.symbol));
}

// ---- Backfill resume ----

export type ClosesStatus = 'done' | 'empty' | 'failed' | 'stale';

/** Which universe symbols the backfill still has to fetch, in universe order. Never fetched symbols
 *  and stale ones always; failed ones only when `retryFailed`. Done and empty ones are left alone. */
export function planBackfill(
	universe: UniverseScrip[],
	existing: Map<string, ClosesStatus>,
	retryFailed: boolean
): UniverseScrip[] {
	return universe.filter((u) => {
		const s = existing.get(u.symbol);
		if (s == null || s === 'stale') return true;
		return s === 'failed' && retryFailed;
	});
}

/** Candles into the stored shape: weekend-dated ones and non-positive closes dropped, one close per
 *  day (the later wins), oldest first. */
export function candlesToSeries(candles: { date: string; close: number }[]): { days: number[]; closes: number[] } {
	const byDay = new Map<number, number>();
	for (const c of candles) {
		const iso = c.date.slice(0, 10);
		if (isWeekend(iso) || !(c.close > 0) || !Number.isFinite(c.close)) continue;
		byDay.set(isoToDay(iso), c.close);
	}
	const days = [...byDay.keys()].sort((a, b) => a - b);
	return { days, closes: days.map((d) => byDay.get(d)!) };
}

// ---- Daily append ----

export interface StoredTip {
	symbol: string;
	lastDay: number;
}
export interface QuotePoint {
	day: number;
	/** ISO date of the quote, to test for weekends. */
	iso: string;
	price: number;
}

export interface DailyPlan {
	/** A new session after the stored one: add the day and close. */
	append: { symbol: string; day: number; close: number }[];
	/** The quote is the stored last session: replace its close (a settled figure after a provisional one). */
	replace: { symbol: string; day: number; close: number }[];
	/** Symbols that missed an earlier session the rest of the market has: refetch their history. */
	stale: string[];
	/** Counts of what was left alone. */
	skipped: { noQuote: number; weekend: number; old: number };
}

/** The most common last day among the symbols (the previous common session). */
export function commonLastDay(tips: StoredTip[]): number | null {
	const counts = new Map<number, number>();
	for (const t of tips) counts.set(t.lastDay, (counts.get(t.lastDay) ?? 0) + 1);
	let best: number | null = null;
	for (const [d, c] of counts) if (best == null || c > counts.get(best)! || (c === counts.get(best) && d > best)) best = d;
	return best;
}

/** Decides what to do with each symbol's quote. Weekend-dated quotes (the feed re-dates Friday's
 *  figures on weekends) and quotes older than the stored session are skipped; a symbol with no
 *  quote (delisted, suspended) is left as it is. A symbol whose stored session is older than the
 *  market's previous common session, and which now has a newer quote, has a hole in its history, so it
 *  is marked stale instead of getting a close appended across the hole. */
export function planDailyAppend(tips: StoredTip[], quotes: Map<string, QuotePoint>): DailyPlan {
	const plan: DailyPlan = { append: [], replace: [], stale: [], skipped: { noQuote: 0, weekend: 0, old: 0 } };
	// The market's previous common session: the usual last day among symbols still behind the newest quote day.
	let newest = 0;
	for (const q of quotes.values()) if (!isWeekend(q.iso) && q.day > newest) newest = q.day;
	const previous = commonLastDay(tips.filter((t) => t.lastDay < newest));
	for (const t of tips) {
		const q = quotes.get(t.symbol);
		if (!q) {
			plan.skipped.noQuote++;
			continue;
		}
		if (isWeekend(q.iso)) {
			plan.skipped.weekend++;
			continue;
		}
		if (q.day < t.lastDay) {
			plan.skipped.old++;
		} else if (q.day === t.lastDay) {
			plan.replace.push({ symbol: t.symbol, day: q.day, close: q.price });
		} else if (previous != null && t.lastDay < previous) {
			plan.stale.push(t.symbol);
		} else {
			plan.append.push({ symbol: t.symbol, day: q.day, close: q.price });
		}
	}
	return plan;
}
