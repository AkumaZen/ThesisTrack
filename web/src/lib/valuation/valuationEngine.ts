export type MethodId = 'pe' | 'pb' | 'ev_ebitda' | 'mcap_sales';
export type ScenarioId = 'bear' | 'base' | 'bull';

export interface YearAssumptions {
	revenueGrowthPct: number;
	expensePct: number; // expenses as a % of that same year's sales, not a YoY growth rate
	otherIncome: number;
	interest: number;
	depreciation: number;
	taxPct: number;
	dividendPayoutPct: number;
	netDebt: number; // for EV/EBITDA — carried/editable per year
	targetMultiple: number; // meaning depends on active method (PE / P/B / EV-EBITDA / Mkt Cap-Sales)
}

export interface ScenarioAssumptions {
	years: [YearAssumptions, YearAssumptions, YearAssumptions];
}

export interface ProjectedYear {
	sales: number;
	expenses: number;
	ebitda: number;
	otherIncome: number;
	interest: number;
	depreciation: number;
	pbt: number;
	tax: number;
	netProfit: number;
	eps: number;
	bookValuePerShare: number;
	impliedPrice: number;
}

// Default expense ratio when a scenario doesn't specify one — 85% of sales, i.e. a 15%
// operating margin, applied flat across bear/base/bull alike (matching how little the
// existing growth-rate defaults differentiate between scenarios).
const DEFAULT_EXPENSE_PCT = 85;

export function defaultYearAssumptions(overrides: Partial<YearAssumptions> = {}): YearAssumptions {
	return {
		revenueGrowthPct: 15,
		expensePct: DEFAULT_EXPENSE_PCT,
		otherIncome: 0,
		interest: 0,
		depreciation: 0,
		taxPct: 25,
		dividendPayoutPct: 0,
		netDebt: 0,
		targetMultiple: 20,
		...overrides
	};
}

export function defaultScenario(targetMultiple: number, growth: number[]): ScenarioAssumptions {
	return {
		years: [0, 1, 2].map((i) =>
			defaultYearAssumptions({ revenueGrowthPct: growth[i], targetMultiple })
		) as ScenarioAssumptions['years']
	};
}

export const METHODS: MethodId[] = ['pe', 'pb', 'ev_ebitda', 'mcap_sales'];
export const SCENARIOS: ScenarioId[] = ['bear', 'base', 'bull'];

const DEFAULT_TARGET_MULTIPLE: Record<MethodId, number> = {
	pe: 20,
	pb: 3,
	ev_ebitda: 12,
	mcap_sales: 3
};
const DEFAULT_GROWTH_PCT: Record<ScenarioId, number> = { bear: 8, base: 15, bull: 22 };

/** A flat-growth starting scenario for a method/scenario pair — the same defaults the
 *  company page seeds a fresh model with, reused by JSON import so an unspecified
 *  method/scenario still resolves to something sensible instead of being left blank. */
export function freshScenario(method: MethodId, scenario: ScenarioId): ScenarioAssumptions {
	const growth = DEFAULT_GROWTH_PCT[scenario];
	return {
		years: [0, 1, 2].map(() =>
			defaultYearAssumptions({
				revenueGrowthPct: growth,
				targetMultiple: DEFAULT_TARGET_MULTIPLE[method]
			})
		) as ScenarioAssumptions['years']
	};
}

export function freshAllAssumptions(): Record<MethodId, Record<ScenarioId, ScenarioAssumptions>> {
	const all = {} as Record<MethodId, Record<ScenarioId, ScenarioAssumptions>>;
	for (const m of METHODS) {
		all[m] = {} as Record<ScenarioId, ScenarioAssumptions>;
		for (const s of SCENARIOS) all[m][s] = freshScenario(m, s);
	}
	return all;
}

/** Rolls the P&L forward 3 years from the last locked historical year, applying the
 * terminal valuation multiple appropriate to the active method. */
export function project(
	method: MethodId,
	baseSales: number,
	baseBookValuePerShare: number,
	shares: number,
	assumptions: ScenarioAssumptions
): ProjectedYear[] {
	const years: ProjectedYear[] = [];
	let prevSales = baseSales;
	let prevBVPS = baseBookValuePerShare;

	for (const rawYear of assumptions.years) {
		// Defends against a year-assumptions object that didn't go through this module's own
		// defaulting (defaultYearAssumptions/freshScenario) — e.g. a hand-written or manually
		// edited localStorage record missing a field entirely. A missing/non-numeric field
		// reads as `undefined`, and `undefined / 100` is NaN, which then poisons every
		// downstream value (sales, EBITDA, implied price, CAGR) with no guard catching it
		// before it reaches the UI as a literal "NaN%". Coalescing to the same defaults
		// `defaultYearAssumptions` uses keeps this function correct for every caller, not
		// just the watchlist row that first surfaced this.
		const a: YearAssumptions = {
			revenueGrowthPct: Number.isFinite(rawYear.revenueGrowthPct) ? rawYear.revenueGrowthPct : 15,
			expensePct: Number.isFinite(rawYear.expensePct) ? rawYear.expensePct : DEFAULT_EXPENSE_PCT,
			otherIncome: Number.isFinite(rawYear.otherIncome) ? rawYear.otherIncome : 0,
			interest: Number.isFinite(rawYear.interest) ? rawYear.interest : 0,
			depreciation: Number.isFinite(rawYear.depreciation) ? rawYear.depreciation : 0,
			taxPct: Number.isFinite(rawYear.taxPct) ? rawYear.taxPct : 25,
			dividendPayoutPct: Number.isFinite(rawYear.dividendPayoutPct) ? rawYear.dividendPayoutPct : 0,
			netDebt: Number.isFinite(rawYear.netDebt) ? rawYear.netDebt : 0,
			targetMultiple: Number.isFinite(rawYear.targetMultiple) ? rawYear.targetMultiple : 20
		};
		const sales = prevSales * (1 + a.revenueGrowthPct / 100);
		// Expenses are a direct % of this same year's sales (a margin assumption), not a
		// compounding growth rate off last year's expenses — so this no longer needs to
		// track a running previous-year expense figure at all.
		const expenses = sales * (a.expensePct / 100);
		const ebitda = sales - expenses;
		const pbt = ebitda + a.otherIncome - a.interest - a.depreciation;
		const tax = pbt * (a.taxPct / 100);
		const netProfit = pbt - tax;
		const eps = shares > 0 ? netProfit / shares : 0;
		const retainedPerShare = (eps * (100 - a.dividendPayoutPct)) / 100;
		const bookValuePerShare = prevBVPS + retainedPerShare;

		let impliedPrice: number;
		switch (method) {
			case 'pe':
				impliedPrice = eps * a.targetMultiple;
				break;
			case 'pb':
				impliedPrice = bookValuePerShare * a.targetMultiple;
				break;
			case 'ev_ebitda': {
				const equityValue = ebitda * a.targetMultiple - a.netDebt;
				impliedPrice = shares > 0 ? equityValue / shares : 0;
				break;
			}
			case 'mcap_sales': {
				const mktCap = sales * a.targetMultiple;
				impliedPrice = shares > 0 ? mktCap / shares : 0;
				break;
			}
		}

		years.push({
			sales,
			expenses,
			ebitda,
			otherIncome: a.otherIncome,
			interest: a.interest,
			depreciation: a.depreciation,
			pbt,
			tax,
			netProfit,
			eps,
			bookValuePerShare,
			impliedPrice
		});

		prevSales = sales;
		prevBVPS = bookValuePerShare;
	}

	return years;
}

export function cagr(target: number, base: number, years: number): number {
	// `NaN <= 0` is always false, so the numeric guard alone lets a NaN target/base slip
	// through as a NaN return — Number.isFinite() is required to actually catch it.
	if (!Number.isFinite(target) || !Number.isFinite(base) || base <= 0 || target <= 0) return 0;
	return (Math.pow(target / base, 1 / years) - 1) * 100;
}

export const METHOD_LABELS: Record<MethodId, string> = {
	pe: 'P/E — EPS Based',
	pb: 'P/B — Book Value Based',
	ev_ebitda: 'EV/EBITDA Based',
	mcap_sales: 'Mkt Cap / Sales Based'
};

export const METHOD_MULTIPLE_LABEL: Record<MethodId, string> = {
	pe: 'Target PE (x)',
	pb: 'Target P/B (x)',
	ev_ebitda: 'Target EV/EBITDA (x)',
	mcap_sales: 'Target Mkt Cap/Sales (x)'
};
