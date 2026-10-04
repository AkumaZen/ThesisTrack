// The Excel export of one company's valuation: a summary of every method and scenario, and the
// full projection (assumptions and projected P&L) behind each. Pure - builds sheet data only.

import { FORMATS, type Sheet } from './exportXlsx';
import { fairValueFromTarget, upsidePct } from './fairValue';
import {
	METHODS,
	SCENARIOS,
	cagr,
	project,
	type MethodId,
	type ScenarioAssumptions,
	type ScenarioId
} from './valuationEngine';

export interface ValuationExportInput {
	name: string;
	symbol: string;
	cmp: number | null;
	shares: number;
	baseSales: number;
	baseBookValuePerShare: number;
	assumptions: Record<MethodId, Record<ScenarioId, ScenarioAssumptions>>;
	activeMethod: MethodId;
	/** The team's fair value setting, % of the target. */
	fairValuePct: number;
	exportedBy: string;
	exportedAt: Date;
}

const METHOD_NAMES: Record<MethodId, string> = {
	pe: 'P/E',
	pb: 'P/B',
	ev_ebitda: 'EV/EBITDA',
	mcap_sales: 'Mkt cap / Sales'
};
const SCENARIO_NAMES: Record<ScenarioId, string> = { bear: 'Bear', base: 'Base', bull: 'Bull' };
const YEARS = ['FY+1E', 'FY+2E', 'FY+3E'];

export function valuationSheets(v: ValuationExportInput): Sheet[] {
	const cmp = v.cmp != null && v.cmp > 0 ? v.cmp : null;
	const projections = METHODS.flatMap((method) =>
		SCENARIOS.map((scenario) => ({
			method,
			scenario,
			years: project(
				method,
				v.baseSales,
				v.baseBookValuePerShare,
				v.shares,
				v.assumptions[method][scenario]
			)
		}))
	);

	const summary: Sheet = {
		name: 'Summary',
		notes: [
			`${v.name} (${v.symbol}) valuation, exported ${v.exportedAt.toLocaleString('en-IN')} by ${v.exportedBy}.`,
			`CMP ${cmp ?? 'n/a'}; shares ${v.shares} cr; last full-year sales ${v.baseSales} cr; book value per share ${v.baseBookValuePerShare}.`,
			`Method in use on the dashboard: ${METHOD_NAMES[v.activeMethod]}. Target = Base FY+2E implied price; fair value = ${v.fairValuePct}% of it.`
		],
		columns: [
			{ header: 'Method', width: 18 },
			{ header: 'Scenario', width: 10 },
			{ header: 'FY+1E price', format: FORMATS.price, width: 13 },
			{ header: 'FY+2E price', format: FORMATS.price, width: 13 },
			{ header: 'FY+3E price', format: FORMATS.price, width: 13 },
			{ header: 'Upside to FY+2E', format: FORMATS.pct, width: 16 },
			{ header: '2-year CAGR', format: FORMATS.pct, width: 13 },
			{ header: 'Fair value (Base only)', format: FORMATS.price, width: 20 }
		],
		rows: projections.map(({ method, scenario, years }) => {
			const fy2 = years[1]?.impliedPrice ?? null;
			return [
				METHOD_NAMES[method] + (method === v.activeMethod ? ' (in use)' : ''),
				SCENARIO_NAMES[scenario],
				years[0]?.impliedPrice,
				fy2,
				years[2]?.impliedPrice,
				upsidePct(fy2, cmp),
				cmp && fy2 ? cagr(fy2, cmp, 2) : null,
				scenario === 'base' ? fairValueFromTarget(fy2, v.fairValuePct) : null
			];
		})
	};

	const detail: Sheet = {
		name: 'Projections',
		notes: ['Amounts in Rs crore except per-share figures and percentages.'],
		columns: [
			{ header: 'Method', width: 16 },
			{ header: 'Scenario', width: 10 },
			{ header: 'Year', width: 8 },
			{ header: 'Sales growth %', format: '0.0', width: 14 },
			{ header: 'Expenses % of sales', format: '0.0', width: 18 },
			{ header: 'Other income', format: FORMATS.price },
			{ header: 'Interest', format: FORMATS.price },
			{ header: 'Depreciation', format: FORMATS.price },
			{ header: 'Tax %', format: '0.0' },
			{ header: 'Dividend payout %', format: '0.0', width: 17 },
			{ header: 'Net debt', format: FORMATS.price },
			{ header: 'Target multiple', format: '0.0"x"', width: 15 },
			{ header: 'Sales', format: FORMATS.price },
			{ header: 'Expenses', format: FORMATS.price },
			{ header: 'EBITDA', format: FORMATS.price },
			{ header: 'PBT', format: FORMATS.price },
			{ header: 'Tax', format: FORMATS.price },
			{ header: 'Net profit', format: FORMATS.price },
			{ header: 'EPS', format: FORMATS.price },
			{ header: 'Book value / share', format: FORMATS.price, width: 17 },
			{ header: 'Implied price', format: FORMATS.price, width: 13 }
		],
		rows: projections.flatMap(({ method, scenario, years }) =>
			years.map((p, i) => {
				const a = v.assumptions[method][scenario].years[i];
				return [
					METHOD_NAMES[method],
					SCENARIO_NAMES[scenario],
					YEARS[i],
					a.revenueGrowthPct,
					a.expensePct,
					a.otherIncome,
					a.interest,
					a.depreciation,
					a.taxPct,
					a.dividendPayoutPct,
					a.netDebt,
					a.targetMultiple,
					p.sales,
					p.expenses,
					p.ebitda,
					p.pbt,
					p.tax,
					p.netProfit,
					p.eps,
					p.bookValuePerShare,
					p.impliedPrice
				];
			})
		)
	};
	return [summary, detail];
}
