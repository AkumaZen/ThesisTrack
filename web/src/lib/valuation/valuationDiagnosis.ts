import type { MethodId } from './valuationEngine';

export interface DiagnosisInput {
	history: { label: string; sales: number | null; netProfit: number | null }[];
	balanceSheet: { borrowings: number | null; totalAssets: number | null } | null;
	cashConversionCycle: number | null;
	industry: string | null;
}

export interface Diagnosis {
	method: MethodId;
	label: string;
	reasons: string[];
	/** True when the underlying data is too thin to diagnose confidently (falls back to PE). */
	lowConfidence: boolean;
}

function cagrPct(first: number, last: number, periods: number): number | null {
	if (first <= 0 || last <= 0 || periods <= 0) return null;
	return (Math.pow(last / first, 1 / periods) - 1) * 100;
}

/**
 * Applies the business-valuation-scenarios skill's Step 1 diagnostic table to whatever
 * signals the scraper could actually extract. Never invents a sector/financials classification
 * we have no data for (e.g. bank/NBFC detection) — those rows of the skill's table are
 * skipped rather than guessed at, and the result says so via `lowConfidence`.
 */
export function diagnoseValuationMethod(input: DiagnosisInput): Diagnosis {
	// Sector classification overrides the generic P&L-shape heuristics below: earnings
	// multiples mislead for balance-sheet-heavy businesses regardless of how smooth their
	// PAT trend looks, since interest income/expense IS the business, not noise.
	if (input.industry && /\b(bank|nbfc|insurance|housing finance)\b/i.test(input.industry)) {
		return {
			method: 'pb',
			label: 'P/B',
			reasons: [
				`Industry classification is "${input.industry}" — a balance-sheet-heavy financial business.`,
				'Book value and RoE matter more than earnings multiples for banks/NBFCs/insurers.'
			],
			lowConfidence: false
		};
	}

	const years = input.history.filter((y) => y.sales != null || y.netProfit != null);

	if (years.length < 3) {
		return {
			method: 'pe',
			label: 'P/E',
			reasons: ['Not enough historical years scraped to diagnose reliably — defaulting to P/E.'],
			lowConfidence: true
		};
	}

	const first = years[0];
	const last = years[years.length - 1];
	const periods = years.length - 1;

	const salesCagr =
		first.sales != null && last.sales != null ? cagrPct(first.sales, last.sales, periods) : null;
	const patCagr =
		first.netProfit != null && last.netProfit != null
			? cagrPct(first.netProfit, last.netProfit, periods)
			: null;

	const patValues = years.map((y) => y.netProfit).filter((v): v is number => v != null);
	const hasNegativePat = patValues.some((v) => v <= 0);

	// Volatility proxy: how much consecutive-year PAT growth swings, as a fraction of its
	// own average magnitude. High = erratic (interest/dep/tax noise or turnaround), not a
	// clean base to put a PE multiple on.
	const patGrowthRates: number[] = [];
	for (let i = 1; i < years.length; i++) {
		const prev = years[i - 1].netProfit;
		const cur = years[i].netProfit;
		if (prev != null && cur != null && prev !== 0) {
			patGrowthRates.push((cur - prev) / Math.abs(prev));
		}
	}
	const avgGrowth = patGrowthRates.length
		? patGrowthRates.reduce((a, b) => a + b, 0) / patGrowthRates.length
		: 0;
	const growthVariance = patGrowthRates.length
		? patGrowthRates.reduce((a, b) => a + (b - avgGrowth) ** 2, 0) / patGrowthRates.length
		: 0;
	const patVolatile = Math.sqrt(growthVariance) > 0.5; // >50% stdev in YoY growth rate

	const leverage =
		input.balanceSheet?.borrowings != null && input.balanceSheet?.totalAssets
			? input.balanceSheet.borrowings / input.balanceSheet.totalAssets
			: null;
	const assetHeavy = leverage != null && leverage > 0.35;

	const workingCapitalHeavy = input.cashConversionCycle != null && input.cashConversionCycle > 120;

	if (hasNegativePat && salesCagr != null && salesCagr > 0) {
		return {
			method: 'mcap_sales',
			label: 'Mkt Cap / Sales (EV/Sales proxy)',
			reasons: [
				'Net profit was negative or near-zero in at least one of the last ' +
					`${years.length} years, but sales still grew ${salesCagr.toFixed(1)}% CAGR over that period.`,
				'PAT is not yet a stable base to multiply — sales-based valuation is more defensible.'
			],
			lowConfidence: false
		};
	}

	if (patVolatile) {
		return {
			method: 'ev_ebitda',
			label: 'EV/EBITDA',
			reasons: [
				'Net profit swings sharply year to year (likely interest/depreciation/tax noise from ' +
					'a leveraged capex cycle), which distorts a PE multiple.',
				'EV/EBITDA strips out capital-structure and depreciation noise for better year-to-year comparability.'
			],
			lowConfidence: false
		};
	}

	if (assetHeavy) {
		return {
			method: 'ev_ebitda',
			label: 'EV/EBITDA',
			reasons: [
				`Borrowings are ${leverage != null ? (leverage * 100).toFixed(0) : '?'}% of total assets — ` +
					'an asset-heavy, capex-driven balance sheet where capacity utilization drives the story.',
				'EV/EBITDA is more standard than PE for leveraged, asset-intensive businesses.'
			],
			lowConfidence: false
		};
	}

	if (workingCapitalHeavy) {
		return {
			method: 'ev_ebitda',
			label: 'EV/EBITDA',
			reasons: [
				`Cash conversion cycle is ${input.cashConversionCycle} days — working-capital-heavy, ` +
					'so reported PAT can overstate actual cash generation.',
				'Preferring EV/EBITDA over pure PE for this reason; treat PAT-based multiples with caution.'
			],
			lowConfidence: false
		};
	}

	return {
		method: 'pe',
		label: 'P/E',
		reasons: [
			patCagr != null
				? `Profit has grown steadily (${patCagr.toFixed(1)}% CAGR over ${years.length} years) without ` +
					'the volatility or leverage signals that would favor an alternative metric.'
				: 'No red flags (negative PAT, high volatility, heavy leverage, or working-capital strain) detected.',
			'PE is the market convention for a stable, mature, consistently profitable business.'
		],
		lowConfidence: false
	};
}
