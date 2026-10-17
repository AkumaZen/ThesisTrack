// Entry-price rules shared by the create form, the thesis APIs, the thesis page and the backfill
// script (plain JS so Node can run the script against it). No database or network access here.

/** @typedef {'manual' | 'auto' | 'backfill_buy' | 'backfill_history' | 'no_data'} EntrySource */

/** The newest stored close dated on or before `date`, or null when none (or the date is bad).
 *  `dates` are ascending 'YYYY-MM-DD' strings paired index-for-index with `closes`.
 *  @param {string[]} dates @param {number[]} closes @param {string} date */
export function closeOnOrBefore(dates, closes, date) {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
	for (let i = Math.min(dates.length, closes.length) - 1; i >= 0; i--) {
		const d = String(dates[i]).slice(0, 10);
		if (d <= date && Number.isFinite(closes[i]) && closes[i] > 0) return { date: d, price: closes[i] };
	}
	return null;
}

/** The newest usable stored close, or null.
 *  @param {string[]} dates @param {number[]} closes */
export function latestClose(dates, closes) {
	return closeOnOrBefore(dates, closes, '9999-12-31');
}

/** Percent change from entry to current, or null when either price is missing, not finite or not
 *  above zero (a zero or negative entry would give a meaningless or infinite return).
 *  @param {number | null | undefined} entry @param {number | null | undefined} current */
export function returnPct(entry, current) {
	if (entry == null || current == null) return null;
	if (!Number.isFinite(entry) || !Number.isFinite(current) || entry <= 0 || current <= 0) return null;
	return ((current - entry) / entry) * 100;
}

/** "+12.3%", "-4.0%", "0.0%": the sign is always spelled out so colour is never the only cue.
 *  @param {number | null} pct */
export function formatReturn(pct) {
	if (pct == null) return '';
	const r = Math.round(pct * 10) / 10;
	return `${r > 0 ? '+' : ''}${r.toFixed(1)}%`;
}

/** Whether a typed price is a usable entry price (finite, above zero).
 *  @param {unknown} v @returns {v is number} */
export function isValidPrice(v) {
	return typeof v === 'number' && Number.isFinite(v) && v > 0;
}

/**
 * What a new thesis stores as its entry price, in order: the price the user typed; else the stored
 * close on/before the buy date; else, if the company has no price source at all, "no data"; else
 * an error telling the caller to send entry_price.
 * @param {{ manual?: number | null, date: string, stored: { date: string, price: number } | null, listed: boolean | null }} i
 * @returns {{ ok: true, price: number | null, source: EntrySource, priceDate: string | null }
 *          | { ok: false, error: string }}
 */
export function resolveEntryPrice({ manual, date, stored, listed }) {
	if (manual != null) {
		if (!isValidPrice(manual)) return { ok: false, error: 'entry_price must be a number above zero' };
		return { ok: true, price: manual, source: 'manual', priceDate: date };
	}
	if (stored) return { ok: true, price: stored.price, source: 'auto', priceDate: stored.date };
	if (listed === false) return { ok: true, price: null, source: 'no_data', priceDate: null };
	return {
		ok: false,
		error:
			`No stored market price for this company on or before ${date}. ` +
			'Send "entry_price" (the buy price, a number above zero) and optionally "entry_date" (YYYY-MM-DD) with the request.'
	};
}

/**
 * The backfill order for an existing thesis: the first recorded buy price (a logged buy decision),
 * else the stored close on/before the creation date, else flag it as needing a price.
 * @param {{ firstBuy: { price: number, date: string } | null, history: { date: string, price: number } | null }} i
 * @returns {{ price: number | null, date: string | null, source: EntrySource | null, needsPrice: boolean }}
 */
export function chooseBackfill({ firstBuy, history }) {
	if (firstBuy && isValidPrice(firstBuy.price)) {
		return { price: firstBuy.price, date: firstBuy.date, source: 'backfill_buy', needsPrice: false };
	}
	if (history && isValidPrice(history.price)) {
		return { price: history.price, date: history.date, source: 'backfill_history', needsPrice: false };
	}
	return { price: null, date: null, source: null, needsPrice: true };
}
