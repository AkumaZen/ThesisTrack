// Stale-thesis rule: a thesis needs another look when it was last reviewed more than 90 days ago,
// or when the price has moved 20% or more (either way) since the review day. Pure functions.

export const STALE_AFTER_DAYS = 90;
export const STALE_MOVE_PCT = 20;

export interface StaleInput {
	/** 'YYYY-MM-DD' */
	lastReviewed: string | null | undefined;
	/** 'YYYY-MM-DD', today in India */
	today: string;
	/** Stored close on or before lastReviewed; null when none is stored. */
	priceAtReview: number | null | undefined;
	/** Latest stored close. */
	currentPrice: number | null | undefined;
}

export interface StaleResult {
	stale: boolean;
	/** Whole days since the review (null when the date is unusable). */
	days: number | null;
	oldReview: boolean;
	/** Price change since the review day in %, null when either price is missing. */
	movePct: number | null;
	bigMove: boolean;
}

const DAY_MS = 86_400_000;
const isDate = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}/.test(s);
const okPrice = (n: number | null | undefined): n is number =>
	typeof n === 'number' && Number.isFinite(n) && n > 0;

export function daysBetween(from: string, to: string): number | null {
	if (!isDate(from) || !isDate(to)) return null;
	return Math.round((Date.parse(`${to.slice(0, 10)}T00:00:00Z`) - Date.parse(`${from.slice(0, 10)}T00:00:00Z`)) / DAY_MS);
}

export function staleThesis(i: StaleInput): StaleResult {
	const days = i.lastReviewed ? daysBetween(i.lastReviewed, i.today) : null;
	const oldReview = days != null && days > STALE_AFTER_DAYS;
	const movePct =
		okPrice(i.priceAtReview) && okPrice(i.currentPrice)
			? ((i.currentPrice - i.priceAtReview) / i.priceAtReview) * 100
			: null;
	// Rounded first so a move of exactly 20% is not lost to floating point (80 to 96).
	const bigMove = movePct != null && Math.abs(Math.round(movePct * 1e6) / 1e6) >= STALE_MOVE_PCT;
	return { stale: oldReview || bigMove, days, oldReview, movePct, bigMove };
}

/** The reasons to show, in plain words. Empty when the thesis is not stale. */
export function staleReasons(
	r: StaleResult,
	priceAtReview?: number | null,
	currentPrice?: number | null
): string[] {
	const out: string[] = [];
	if (r.oldReview && r.days != null) out.push(`Not reviewed in ${r.days} days`);
	if (r.bigMove && r.movePct != null) {
		const pct = `${r.movePct > 0 ? '+' : ''}${(Math.round(r.movePct * 10) / 10).toFixed(1)}%`;
		const range =
			okPrice(priceAtReview) && okPrice(currentPrice)
				? ` (\u20B9${fmt(priceAtReview)} to \u20B9${fmt(currentPrice)})`
				: '';
		out.push(`Price moved ${pct} since last review${range}`);
	}
	return out;
}

const fmt = (n: number) => n.toLocaleString('en-IN', { maximumFractionDigits: 2 });
