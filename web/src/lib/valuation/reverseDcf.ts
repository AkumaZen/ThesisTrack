/**
 * Reverse DCF: instead of forecasting growth and reading a value, take the market cap as given and
 * solve for the growth rate the price already assumes. Pure functions, no I/O.
 *
 * Model: earnings E0 grow at a constant rate g for `years` years, then at `terminalGrowth` forever.
 * Everything is discounted at `discountRate`. Value = sum of PV(E_t) + PV(terminal value). The base
 * is net profit (Screener's latest financial year), a stand-in for owner earnings: it is editable on
 * the page because free cash flow is not stored.
 */

export const DEFAULT_DISCOUNT_RATE = 0.12;
export const DEFAULT_TERMINAL_GROWTH = 0.04;
export const DEFAULT_YEARS = 10;

/** The solver searches growth between these (per year). */
const G_MIN = -0.5;
const G_MAX = 1.5;

export interface DcfInputs {
	/** Base earnings, Rs crore (must be positive). */
	baseEarnings: number;
	discountRate: number;
	terminalGrowth: number;
	years: number;
}

/** Present value of the earnings stream when growth is `g` for `years` years then `terminalGrowth`. */
export function dcfValue(g: number, i: DcfInputs): number {
	const { baseEarnings: e0, discountRate: r, terminalGrowth: tg, years } = i;
	let pv = 0;
	let e = e0;
	for (let t = 1; t <= years; t++) {
		e *= 1 + g;
		pv += e / (1 + r) ** t;
	}
	const terminal = (e * (1 + tg)) / (r - tg);
	return pv + terminal / (1 + r) ** years;
}

export type ReverseDcfResult =
	| { kind: 'ok'; growth: number }
	/** Even the top of the search range is worth less than the market cap. */
	| { kind: 'above-range' }
	/** Even the bottom of the search range is worth more than the market cap: the price assumes decline. */
	| { kind: 'below-range' }
	| { kind: 'invalid'; reason: string };

/** The yearly growth (fraction) that makes the DCF value equal `marketCap`, by bisection. */
export function solveImpliedGrowth(marketCap: number, i: DcfInputs): ReverseDcfResult {
	if (!(marketCap > 0)) return { kind: 'invalid', reason: 'Market cap is missing.' };
	if (!(i.baseEarnings > 0)) return { kind: 'invalid', reason: 'Base earnings must be positive.' };
	if (!(i.years >= 1 && Number.isInteger(i.years))) return { kind: 'invalid', reason: 'Years must be a whole number, at least 1.' };
	if (!(i.discountRate > i.terminalGrowth))
		return { kind: 'invalid', reason: 'The discount rate must be above the terminal growth.' };
	if (dcfValue(G_MAX, i) < marketCap) return { kind: 'above-range' };
	if (dcfValue(G_MIN, i) > marketCap) return { kind: 'below-range' };
	let lo = G_MIN;
	let hi = G_MAX;
	for (let n = 0; n < 80; n++) {
		const mid = (lo + hi) / 2;
		if (dcfValue(mid, i) < marketCap) lo = mid;
		else hi = mid;
	}
	return { kind: 'ok', growth: (lo + hi) / 2 };
}

/** Compound growth of the last `years` annual figures (null when either end is not positive). */
export function historicCagr(values: (number | null)[], years: number): number | null {
	if (values.length <= years) return null;
	const end = values[values.length - 1];
	const start = values[values.length - 1 - years];
	if (end == null || start == null || end <= 0 || start <= 0) return null;
	return (end / start) ** (1 / years) - 1;
}
