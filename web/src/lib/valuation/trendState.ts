// What the watchlist's Trend cell can be, and how a sparkline response maps to it. Kept out of the
// page so each failure mode is unit-tested: a missing trend must always say WHY and what to do.

export type TrendState =
	/** Waiting for the stored prices. */
	| 'loading'
	/** Closes available. */
	| 'ok'
	/** Angel One has no listing: there will never be prices. Final. */
	| 'unlisted'
	/** Listed, but nothing stored yet. A refresh fixes it. */
	| 'not_stored'
	/** Fetching prices from Angel One right now (someone pressed Fetch). */
	| 'fetching'
	/** The request failed (network, server error, timeout). Temporary: retry. */
	| 'error';

/** States that will not change by asking again, so they are safe to remember in the browser.
 *  'not_stored' and 'error' are deliberately excluded: caching them is how a trend used to stay
 *  empty for minutes after the data was there. */
export const isFinalTrend = (s: TrendState | undefined): boolean => s === 'ok' || s === 'unlisted';

export interface TrendOutcome {
	state: TrendState;
	closes: number[] | null;
}

/** Maps the sparkline endpoint's answer to a cell state. `status` 0 means the request never
 *  completed (offline, aborted, timed out). */
export function interpretSparkline(status: number, body: unknown): TrendOutcome {
	const b = (body ?? {}) as { closes?: unknown; reason?: unknown };
	if (status === 200) {
		const closes = Array.isArray(b.closes) ? b.closes.filter((c): c is number => typeof c === 'number') : [];
		return closes.length >= 2 ? { state: 'ok', closes } : { state: 'not_stored', closes: null };
	}
	if (status === 404 && b.reason === 'unlisted') return { state: 'unlisted', closes: null };
	if (status === 404 && b.reason === 'not_stored') return { state: 'not_stored', closes: null };
	return { state: 'error', closes: null };
}

/** Text for the cell and its tooltip. */
export const TREND_LABEL: Record<Exclude<TrendState, 'ok' | 'loading'>, { text: string; title: string }> = {
	unlisted: {
		text: 'No price source',
		title: "Angel One doesn't list this symbol (NSE equity only), so there is no price history to chart."
	},
	not_stored: {
		text: 'Fetch',
		title: 'No prices stored for this company yet. Click to fetch them now.'
	},
	fetching: { text: 'Fetching…', title: 'Fetching prices from Angel One.' },
	error: { text: 'Retry', title: "Couldn't load the trend (temporary). Click to try again." }
};
