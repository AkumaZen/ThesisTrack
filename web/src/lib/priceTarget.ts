// Price target tracker for the thesis page: how far the stored price has come from the entry price
// toward the base-case target. Pure maths, no database or network access.

export type TargetState =
	| 'no_current' // no stored price to compare with
	| 'reached' // price is at or above the target
	| 'no_entry' // no entry price, so no progress can be drawn (upside is still shown)
	| 'target_below_entry' // target at or below the entry price: a bar would mislead
	| 'below_entry' // price is under the entry price
	| 'in_progress';

export interface TargetProgress {
	state: TargetState;
	/** Move still needed from the current price to the target, in % (negative once passed). */
	upsidePct: number | null;
	/** (current - entry) / (target - entry) in %, unclamped. Null when it would mean nothing. */
	progressPct: number | null;
	/** The same, clamped to 0..100 for drawing the bar. */
	barPct: number | null;
	/** Yearly return still needed to reach the target in `years` years (null if not applicable). */
	requiredAnnualPct: number | null;
}

/** Years from today to the FY+2E horizon, as the watchlist's "Base CAGR (2yr)" counts them. */
export const TARGET_HORIZON_YEARS = 2;

const ok = (n: number | null | undefined): n is number =>
	typeof n === 'number' && Number.isFinite(n) && n > 0;

export function targetProgress(
	entry: number | null | undefined,
	current: number | null | undefined,
	target: number,
	years = TARGET_HORIZON_YEARS
): TargetProgress {
	const none = { upsidePct: null, progressPct: null, barPct: null, requiredAnnualPct: null };
	if (!ok(target)) return { state: 'no_current', ...none };
	if (!ok(current)) return { state: 'no_current', ...none };

	const upsidePct = ((target - current) / current) * 100;
	const requiredAnnualPct = current < target ? (Math.pow(target / current, 1 / years) - 1) * 100 : null;
	const base = { upsidePct, requiredAnnualPct };

	if (current >= target) {
		return { state: 'reached', ...base, progressPct: null, barPct: 100 };
	}
	if (!ok(entry)) return { state: 'no_entry', ...base, progressPct: null, barPct: null };
	if (target <= entry) return { state: 'target_below_entry', ...base, progressPct: null, barPct: null };

	const progressPct = ((current - entry) / (target - entry)) * 100;
	const barPct = Math.min(100, Math.max(0, progressPct));
	return { state: current < entry ? 'below_entry' : 'in_progress', ...base, progressPct, barPct };
}
