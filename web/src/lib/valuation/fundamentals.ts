/**
 * Fundamental measures from the Screener statements already stored per company, for the scanner's
 * fundamental presets and the quarterly results table. Pure: nothing here reads a database or the
 * network. Missing inputs give null for that measure, never a guess.
 */
import { growthPct, monthIndex, type QuarterRow } from './quarters';

/** One financial year, joined across Screener's P&L, balance sheet and ratios tables (Rs crore, % for the ratios). */
export interface AnnualRow {
	label: string; // "Mar 2025"
	sales: number | null;
	opmPct: number | null;
	netProfit: number | null;
	/** Equity capital plus reserves. */
	equity: number | null;
	borrowings: number | null;
	fixedAssets: number | null;
	cwip: number | null;
	roce: number | null;
}

/** A stored quarter with the extra line the results table needs. */
export interface ResultQuarter extends QuarterRow {
	opmPct: number | null;
}

// ---- Named thresholds (the preset descriptions in presetScans.ts quote these) ----

/** High ROCE: latest financial year at least this (%), and the average of the last three years at least the second figure. */
export const HIGH_ROCE_PCT = 20;
export const HIGH_ROCE_AVG3_PCT = 15;
/** Low debt: borrowings at most this multiple of equity (equity capital plus reserves). */
export const LOW_DEBT_MAX_DE = 0.5;
/** OPM expansion: the latest quarter's operating margin is at least this many percentage points above the same quarter a year before. */
export const OPM_EXPANSION_PP = 2;
/** 3Y CAGR: sales and net profit both compound at least this (%) a year over three financial years. */
export const CAGR_3Y_MIN_PCT = 15;
export const CAGR_YEARS = 3;
/** Heavy capex: fixed assets plus capital work in progress grew at least this (%) in the latest year, and
 *  work in progress is at least the second figure (%) of fixed assets. */
export const CAPEX_GROWTH_MIN_PCT = 20;
export const CAPEX_CWIP_MIN_PCT = 10;
/** Deleverage: borrowings fell at least this (%) in the latest year and did not rise the year before. */
export const DELEVERAGE_MIN_FALL_PCT = 10;
/** Super growth: latest quarter sales and net profit up at least these (%) on a year earlier, plus the 3Y CAGR bar above. */
export const SUPER_SALES_YOY_PCT = 20;
export const SUPER_PROFIT_YOY_PCT = 25;

/** Banks, finance and insurance carry debt as stock in trade, so debt ratios say nothing for them. */
const FINANCIAL_INDUSTRY = /\b(bank|finance|financial|nbfc|insurance|housing finance|broking|capital markets?)\b/i;
export const isFinancialIndustry = (industry: string | null | undefined) =>
	!!industry && FINANCIAL_INDUSTRY.test(industry);

export interface FundamentalMetrics {
	/** Industry looks like a bank or lender: debt-based presets do not apply. */
	financial: boolean;
	/** Latest ROCE in % (Screener's headline figure) and the mean of the last three financial years. */
	roce: number | null;
	roce3yAvg: number | null;
	/** Borrowings / (equity capital + reserves), latest financial year. */
	debtEquity: number | null;
	/** Latest quarter's operating margin minus the same quarter a year earlier, percentage points. */
	opmChangePp: number | null;
	salesYoY: number | null;
	profitYoY: number | null;
	/** Compound annual growth over 3 financial years, %. */
	salesCagr3: number | null;
	profitCagr3: number | null;
	/** Fixed assets plus CWIP, latest year vs the year before, %. */
	capexGrowthPct: number | null;
	/** CWIP as % of fixed assets, latest year. */
	cwipPct: number | null;
	/** Borrowings change, latest year vs the year before, % (negative = falling). */
	borrowingsChangePct: number | null;
	/** Borrowings change the year before that, %, to tell a trend from a one-off. */
	borrowingsPrevChangePct: number | null;
	/** Label of the latest quarter and financial year the figures come from. */
	quarterLabel: string | null;
	yearLabel: string | null;
}

const last = <T>(xs: T[], fromEnd = 0): T | undefined => xs[xs.length - 1 - fromEnd];

function cagr(now: number | null | undefined, then: number | null | undefined, years: number): number | null {
	if (now == null || then == null || !(now > 0) || !(then > 0)) return null;
	return (Math.pow(now / then, 1 / years) - 1) * 100;
}

/** Percentage change that tolerates a zero base only when both are zero. */
function changePct(now: number | null | undefined, then: number | null | undefined): number | null {
	if (now == null || then == null || !Number.isFinite(now) || !Number.isFinite(then)) return null;
	if (then === 0) return now === 0 ? 0 : null;
	return (now / then - 1) * 100;
}

function quarterYearAgo<T extends { label: string }>(quarters: T[]): { now: T; then: T } | null {
	const now = last(quarters);
	if (!now) return null;
	const a = monthIndex(now.label);
	if (a == null) return null;
	const then = quarters.find((q) => monthIndex(q.label) === a - 12);
	return then ? { now, then } : null;
}

export interface FundamentalInputs {
	industry?: string | null;
	/** Screener's headline ROCE %, used when the yearly series is not stored. */
	roce?: number | null;
	quarters?: ResultQuarter[] | null;
	annual?: AnnualRow[] | null;
}

/** Null when there is nothing to measure at all (no quarters and no yearly rows). */
export function computeFundamentalMetrics(input: FundamentalInputs): FundamentalMetrics | null {
	const annual = (input.annual ?? []).filter((r) => monthIndex(r.label) != null);
	const quarters = input.quarters ?? [];
	if (annual.length === 0 && quarters.length === 0) return null;

	const y0 = last(annual);
	const y1 = last(annual, 1);
	const y2 = last(annual, 2);
	const yN = last(annual, CAGR_YEARS);
	// A gap in the labels (a missing year) would make "3 years back" wrong, so insist on exact spacing.
	const spaced = (a: AnnualRow | undefined, b: AnnualRow | undefined, years: number) =>
		!!a && !!b && (monthIndex(a.label) as number) - (monthIndex(b.label) as number) === years * 12;

	const roces = annual.slice(-3).map((r) => r.roce);
	const roce3yAvg =
		roces.length === 3 && roces.every((v): v is number => v != null) ? roces.reduce((a, b) => a + b, 0) / 3 : null;

	const pair = quarterYearAgo(quarters);
	return {
		financial: isFinancialIndustry(input.industry),
		roce: y0?.roce ?? input.roce ?? null,
		roce3yAvg,
		debtEquity:
			y0 && y0.borrowings != null && y0.equity != null && y0.equity > 0 ? y0.borrowings / y0.equity : null,
		opmChangePp:
			pair && pair.now.opmPct != null && pair.then.opmPct != null ? pair.now.opmPct - pair.then.opmPct : null,
		salesYoY: pair ? growthPct(pair.now.sales, pair.then.sales) : null,
		profitYoY: pair ? growthPct(pair.now.netProfit, pair.then.netProfit) : null,
		salesCagr3: spaced(y0, yN, CAGR_YEARS) ? cagr(y0?.sales, yN?.sales, CAGR_YEARS) : null,
		profitCagr3: spaced(y0, yN, CAGR_YEARS) ? cagr(y0?.netProfit, yN?.netProfit, CAGR_YEARS) : null,
		capexGrowthPct:
			spaced(y0, y1, 1) && y0.fixedAssets != null && y1!.fixedAssets != null
				? changePct(y0.fixedAssets + (y0.cwip ?? 0), y1!.fixedAssets + (y1!.cwip ?? 0))
				: null,
		cwipPct:
			y0 && y0.cwip != null && y0.fixedAssets != null && y0.fixedAssets > 0
				? (y0.cwip / y0.fixedAssets) * 100
				: null,
		borrowingsChangePct: spaced(y0, y1, 1) ? changePct(y0?.borrowings, y1?.borrowings) : null,
		borrowingsPrevChangePct: spaced(y1, y2, 1) ? changePct(y1?.borrowings, y2?.borrowings) : null,
		quarterLabel: last(quarters)?.label ?? null,
		yearLabel: y0?.label ?? null
	};
}

// ---- Preset tests (kept here so the thresholds and the rules sit together) ----

export type FundamentalPresetId =
	| 'high-roce'
	| 'low-debt'
	| 'opm-expansion'
	| 'cagr-3y'
	| 'heavy-capex'
	| 'deleverage'
	| 'super-growth';

const ge = (v: number | null | undefined, min: number) => v != null && v >= min;

export function passesFundamentalPreset(id: FundamentalPresetId, m: FundamentalMetrics | null | undefined): boolean {
	if (!m) return false;
	switch (id) {
		case 'high-roce':
			// Lenders' ROCE is not comparable, so they are left out.
			return !m.financial && ge(m.roce, HIGH_ROCE_PCT) && (m.roce3yAvg == null || m.roce3yAvg >= HIGH_ROCE_AVG3_PCT);
		case 'low-debt':
			return !m.financial && m.debtEquity != null && m.debtEquity >= 0 && m.debtEquity <= LOW_DEBT_MAX_DE;
		case 'opm-expansion':
			return ge(m.opmChangePp, OPM_EXPANSION_PP);
		case 'cagr-3y':
			return ge(m.salesCagr3, CAGR_3Y_MIN_PCT) && ge(m.profitCagr3, CAGR_3Y_MIN_PCT);
		case 'heavy-capex':
			return !m.financial && ge(m.capexGrowthPct, CAPEX_GROWTH_MIN_PCT) && ge(m.cwipPct, CAPEX_CWIP_MIN_PCT);
		case 'deleverage':
			return (
				!m.financial &&
				m.borrowingsChangePct != null &&
				m.borrowingsChangePct <= -DELEVERAGE_MIN_FALL_PCT &&
				(m.borrowingsPrevChangePct == null || m.borrowingsPrevChangePct <= 0)
			);
		case 'super-growth':
			return (
				ge(m.salesYoY, SUPER_SALES_YOY_PCT) &&
				ge(m.profitYoY, SUPER_PROFIT_YOY_PCT) &&
				ge(m.salesCagr3, CAGR_3Y_MIN_PCT)
			);
	}
}

export function fundamentalDetail(id: FundamentalPresetId, m: FundamentalMetrics | null | undefined): string {
	if (!m) return '';
	const n = (v: number | null, d = 1) =>
		v == null ? '-' : v.toLocaleString('en-IN', { maximumFractionDigits: d, minimumFractionDigits: d });
	const s = (v: number | null) => (v == null ? '-' : `${v > 0 ? '+' : ''}${n(v)}`);
	switch (id) {
		case 'high-roce':
			return `ROCE ${n(m.roce)}%${m.roce3yAvg != null ? `, 3Y avg ${n(m.roce3yAvg)}%` : ''}`;
		case 'low-debt':
			return `Debt / equity ${n(m.debtEquity, 2)}`;
		case 'opm-expansion':
			return `OPM ${s(m.opmChangePp)} pts YoY${m.quarterLabel ? ` (${m.quarterLabel})` : ''}`;
		case 'cagr-3y':
			return `3Y CAGR: sales ${n(m.salesCagr3)}%, profit ${n(m.profitCagr3)}%`;
		case 'heavy-capex':
			return `Fixed assets + CWIP ${s(m.capexGrowthPct)}%, CWIP ${n(m.cwipPct)}% of fixed assets`;
		case 'deleverage':
			return `Borrowings ${s(m.borrowingsChangePct)}% in ${m.yearLabel ?? 'the latest year'}`;
		case 'super-growth':
			return `${m.quarterLabel ?? 'Latest quarter'}: sales ${s(m.salesYoY)}%, profit ${s(m.profitYoY)}% YoY; 3Y sales CAGR ${n(m.salesCagr3)}%`;
	}
}
