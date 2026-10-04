import { project, type MethodId, type ScenarioAssumptions } from './valuationEngine';
import { diagnoseValuationMethod, type DiagnosisInput } from './valuationDiagnosis';
import type { SavedValuationRecord } from './savedValuations';

/** Fair value is deliberately set below the Base-case target - the team's margin of safety. The
 *  percentage is a team setting (Settings page); 80% (a 20% margin) is the default. The
 *  watchlist, the exports and the server-side alert checks all pass the current setting. */
export const DEFAULT_FAIR_VALUE_PCT = 80;
export const FAIR_VALUE_FACTOR = DEFAULT_FAIR_VALUE_PCT / 100;

/** FY+2E is the second projected year (index 1) - the same year the watchlist's CAGR reads. */
const TARGET_YEAR_INDEX = 1;

const isPositive = (n: number | null | undefined): n is number =>
	typeof n === 'number' && Number.isFinite(n) && n > 0;

/** Base-case FY+2E implied price for one scenario's assumptions, or null if it can't be
 *  computed to a sensible positive number (missing inputs, loss-making model, NaN). */
export function targetPriceFor(
	method: MethodId,
	baseSales: number,
	baseBVPS: number,
	shares: number,
	baseAssumptions: ScenarioAssumptions
): number | null {
	const year = project(method, baseSales, baseBVPS, shares, baseAssumptions)[TARGET_YEAR_INDEX];
	return isPositive(year?.impliedPrice) ? year.impliedPrice : null;
}

export function fairValueFromTarget(
	target: number | null | undefined,
	fairValuePct: number = DEFAULT_FAIR_VALUE_PCT
): number | null {
	return isPositive(target) ? (target * fairValuePct) / 100 : null;
}

/** Upside from CMP to the target, in %. Null unless both are valid positive prices. */
export function upsidePct(
	target: number | null | undefined,
	cmp: number | null | undefined
): number | null {
	if (!isPositive(target) || !isPositive(cmp)) return null;
	return ((target - cmp) / cmp) * 100;
}

export type FairValueSide = 'below' | 'at_or_above';

/** Which side of fair value the price is on. "At" counts as reached. */
export function sideOfFairValue(price: number, fairValue: number): FairValueSide {
	return price >= fairValue ? 'at_or_above' : 'below';
}

/** The slice of scraped company data the target calculation needs - structurally compatible
 *  with the scraper's CompanyFinancials, so server checks and the watchlist share one path. */
export interface CompanyForTarget extends DiagnosisInput {
	cmp: number | null;
	bookValuePerShare: number | null;
	years: { sales: number | null }[];
}

/**
 * Base-case FY+2E target for a saved valuation: exactly what the watchlist shows, computed the
 * same way (active method, falling back to the diagnosed one for older records and imports;
 * base sales = last historical year; same book value and share count). Used by the server-side
 * alert checks, which have no browser to borrow the number from.
 */
export function targetForSaved(
	record: SavedValuationRecord,
	company: CompanyForTarget
): { method: MethodId; target: number } | null {
	const method: MethodId = record.activeMethod ?? diagnoseValuationMethod(company).method;
	const baseAssumptions = record.assumptions?.[method]?.base;
	if (!baseAssumptions) return null;

	const baseSales = company.years[company.years.length - 1]?.sales ?? 0;
	const target = targetPriceFor(
		method,
		baseSales,
		company.bookValuePerShare ?? 0,
		record.shares,
		baseAssumptions
	);
	return target == null ? null : { method, target };
}
