// Forensic red-flag checks from the stored Screener statements. Every check is a plain rule with
// its inputs shown; nothing here is a model output. Checks whose data is not stored are listed as
// "not available" and are left out of the score.

import { NET_PROFIT, series, type Statements } from './financials';

export type CheckStatus = 'pass' | 'fail' | 'na';
export interface Check {
	id: string;
	name: string;
	weight: number;
	status: CheckStatus;
	rule: string;
	inputs: { label: string; value: string }[];
	detail: string;
}
export interface RedFlagReport {
	checks: Check[];
	/** Failed weight as a percentage of the weight of the checks that could be evaluated; null when fewer than two could. */
	score: number | null;
	level: 'clean' | 'watch' | 'high' | 'insufficient';
	failed: number;
	evaluated: number;
}

export interface PledgeInput { pledgedPct: number | null; period: string }

export const CFO_RATIO_MIN = 0.6;
export const RECEIVABLE_RISE = 1.25;
export const RECEIVABLE_RISE_MIN_DAYS = 10;
export const OTHER_INCOME_MAX_PCT = 30;
export const PLEDGE_MAX_PCT = 10;

const f = (n: number, digits = 1) => n.toFixed(digits);
const fy = (date: string) => `FY${date.slice(2, 4)}`;
const sorted = (m: Map<string, number>) => [...m.entries()].sort(([a], [b]) => a.localeCompare(b));

function na(base: Omit<Check, 'status' | 'inputs' | 'detail'>, detail: string, inputs: Check['inputs'] = []): Check {
	return { ...base, status: 'na', inputs, detail };
}

export function cfoVsPat(s: Statements): Check {
	const base = { id: 'cfo_pat', name: 'Operating cash flow vs profit', weight: 3,
		rule: `Fails if cash from operations over the last 3 years is below ${CFO_RATIO_MIN * 100}% of net profit, or if the latest year has positive profit but negative operating cash flow.` };
	const cfo = series(s.cashflow, 'cash from operating activity', 'cash from operating activities');
	const pat = series(s.annual, ...NET_PROFIT);
	const years = sorted(cfo).map(([d]) => d).filter((d) => pat.has(d)).slice(-3);
	if (years.length < 2) return na(base, 'Needs at least two years of both cash flow and net profit.');
	const sumCfo = years.reduce((n, d) => n + cfo.get(d)!, 0), sumPat = years.reduce((n, d) => n + pat.get(d)!, 0);
	const last = years[years.length - 1];
	const inputs = [
		...years.map((d) => ({ label: `${fy(d)} operating cash flow / net profit (Rs Cr)`, value: `${f(cfo.get(d)!, 0)} / ${f(pat.get(d)!, 0)}` })),
		{ label: 'Total operating cash flow / net profit', value: `${f(sumCfo, 0)} / ${f(sumPat, 0)}` }
	];
	if (sumPat <= 0) return na(base, 'Net profit over the period is not positive, so the ratio is not meaningful.', inputs);
	const ratio = sumCfo / sumPat;
	inputs.push({ label: 'Cash conversion', value: `${f(ratio * 100, 0)}%` });
	const negative = cfo.get(last)! < 0 && pat.get(last)! > 0;
	const fail = ratio < CFO_RATIO_MIN || negative;
	return { ...base, status: fail ? 'fail' : 'pass', inputs,
		detail: fail ? (negative ? `${fy(last)} made a profit but operating cash flow was negative.` : `Cash conversion of ${f(ratio * 100, 0)}% is below ${CFO_RATIO_MIN * 100}%.`) : `Cash conversion of ${f(ratio * 100, 0)}% is healthy.` };
}

export function receivableDays(s: Statements): Check {
	const base = { id: 'receivables', name: 'Receivable days rising', weight: 2,
		rule: `Fails if the latest debtor days are at least ${Math.round((RECEIVABLE_RISE - 1) * 100)}% and ${RECEIVABLE_RISE_MIN_DAYS} days above the average of the two years before.` };
	const days = sorted(series(s.ratios, 'debtor days'));
	if (days.length < 3) return na(base, 'Debtor days for three years are not stored. Refresh the financials to fetch them.');
	const [a, b, c] = days.slice(-3);
	const avg = (a[1] + b[1]) / 2;
	const fail = c[1] >= avg * RECEIVABLE_RISE && c[1] - avg >= RECEIVABLE_RISE_MIN_DAYS;
	return { ...base, status: fail ? 'fail' : 'pass',
		inputs: [a, b, c].map(([d, v]) => ({ label: `${fy(d)} debtor days`, value: f(v, 0) })).concat({ label: 'Average of the two earlier years', value: f(avg, 0) }),
		detail: fail ? `Debtor days rose to ${f(c[1], 0)} from an average of ${f(avg, 0)}.` : `Debtor days of ${f(c[1], 0)} against an earlier average of ${f(avg, 0)}.` };
}

export function otherIncomeShare(s: Statements): Check {
	const base = { id: 'other_income', name: 'Other income share of profit', weight: 2,
		rule: `Fails if other income is more than ${OTHER_INCOME_MAX_PCT}% of profit before tax in the latest year.` };
	const other = series(s.annual, 'other income'), pbt = series(s.annual, 'profit before tax');
	const years = sorted(other).map(([d]) => d).filter((d) => pbt.has(d));
	if (!years.length) return na(base, 'Other income and profit before tax are not stored.');
	const d = years[years.length - 1], oi = other.get(d)!, p = pbt.get(d)!;
	const inputs = [{ label: `${fy(d)} other income (Rs Cr)`, value: f(oi, 0) }, { label: `${fy(d)} profit before tax (Rs Cr)`, value: f(p, 0) }];
	if (p <= 0) return oi > 0
		? { ...base, status: 'fail', inputs, detail: 'Profit before tax is not positive while other income is.' }
		: na(base, 'Profit before tax is not positive, so the share is not meaningful.', inputs);
	const share = (oi / p) * 100;
	inputs.push({ label: 'Share', value: `${f(share, 0)}%` });
	const fail = share > OTHER_INCOME_MAX_PCT;
	return { ...base, status: fail ? 'fail' : 'pass', inputs, detail: `Other income is ${f(share, 0)}% of profit before tax.` };
}

export function promoterPledge(p: PledgeInput | null): Check {
	const base = { id: 'pledge', name: 'Promoter pledge', weight: 2, rule: `Fails if the promoters have pledged ${PLEDGE_MAX_PCT}% or more of their holding.` };
	if (!p) return na(base, 'No shareholding snapshot is stored for this company.');
	const inputs = [{ label: `Pledged share of promoter holding (${p.period})`, value: p.pledgedPct == null ? 'none reported' : `${f(p.pledgedPct, 1)}%` }];
	const fail = p.pledgedPct != null && p.pledgedPct >= PLEDGE_MAX_PCT;
	return { ...base, status: fail ? 'fail' : 'pass', inputs, detail: p.pledgedPct == null ? 'No pledge is reported.' : `${f(p.pledgedPct, 1)}% of the promoter holding is pledged.` };
}

const UNAVAILABLE: [string, string, string][] = [
	['contingent', 'Contingent liabilities', 'Contingent liabilities are not in the stored statements (they sit in the annual report notes).'],
	['auditor', 'Auditor qualifications', 'Auditor remarks are not stored (they sit in the annual report).'],
	['related_party', 'Related-party transactions', 'Related-party transactions are not stored (they sit in the annual report).']
];

export function redFlagReport(statements: Statements, pledge: PledgeInput | null): RedFlagReport {
	const scored = [cfoVsPat(statements), receivableDays(statements), otherIncomeShare(statements), promoterPledge(pledge)];
	const unavailable = UNAVAILABLE.map(([id, name, detail]) => na({ id, name, weight: 0, rule: 'Needs annual report data that is not stored.' }, detail));
	const evaluated = scored.filter((c) => c.status !== 'na');
	const failed = evaluated.filter((c) => c.status === 'fail');
	const total = evaluated.reduce((n, c) => n + c.weight, 0);
	const score = evaluated.length < 2 ? null : Math.round((failed.reduce((n, c) => n + c.weight, 0) / total) * 100);
	const level = score == null ? 'insufficient' : score === 0 ? 'clean' : score < 40 ? 'watch' : 'high';
	return { checks: [...scored, ...unavailable], score, level, failed: failed.length, evaluated: evaluated.length };
}
