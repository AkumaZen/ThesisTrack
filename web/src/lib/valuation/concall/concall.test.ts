import { describe, expect, it } from 'vitest';
import { parseTable, periodDate, shiftMonths, statementsFrom } from './financials';
import { allResultQuality, resultQuality } from './resultQuality';
import { cfoVsPat, otherIncomeShare, promoterPledge, receivableDays, redFlagReport } from './redFlags';
import { credibility, evaluateGuidance, periodQuarters, type GuidanceStatement } from './guidance';
import { countCongratulations, findTranscripts, quarterFromTitle } from './transcripts';
import { buildConcallRows, quarterLabel } from './rows';

// Quarters Jun 2024 .. Jun 2026 (9 columns).
const QUARTERS = ['Jun 2024', 'Sep 2024', 'Dec 2024', 'Mar 2025', 'Jun 2025', 'Sep 2025', 'Dec 2025', 'Mar 2026', 'Jun 2026'];
const table = (headers: string[], rows: Record<string, (number | string)[]>) => ({
	years: headers,
	rows: Object.entries(rows).map(([label, values]) => ({ label, values: values.map(String) }))
});
// Steady ~10% growth: each quarter is 10% above the same quarter a year earlier.
const sales = [100, 110, 120, 130, 110, 121, 132, 143, 121];

function quarterly(overrides: Record<string, (number | string)[]> = {}) {
	return table(QUARTERS, {
		'Sales +': sales,
		'Operating Profit': sales.map((s) => s * 0.2),
		'Net Profit +': sales.map((s) => s * 0.1),
		...overrides
	});
}

describe('financial tables', () => {
	it('reads both stored shapes, numbers with commas and percent signs', () => {
		const native = parseTable(table(['Mar 2025', 'TTM'], { 'Sales +': ['1,234', ''], 'OPM %': ['17%', '18%'] }))!;
		expect(native.dates).toEqual(['2025-03-31', null]);
		expect(native.rows.get('sales')).toEqual([1234, null]);
		expect(native.rows.get('opm')).toEqual([17, 18]);
		const mcp = parseTable({ result: { data: { quarters: ['Jun 2026'], rows: [{ label: 'Sales +', values: [251] }] } } })!;
		expect(mcp.rows.get('sales')).toEqual([251]);
		expect(parseTable(JSON.stringify({ years: ['Mar 2025'], rows: [{ label: 'Sales', values: ['5'] }] }))!.rows.get('sales')).toEqual([5]);
		expect(parseTable('not json')).toBeUndefined();
	});
	it('maps period labels to month ends and shifts by months', () => {
		expect(periodDate('Feb 2024')).toBe('2024-02-29');
		expect(periodDate('TTM')).toBeNull();
		expect(shiftMonths('2026-06-30', -12)).toBe('2025-06-30');
		expect(shiftMonths('2026-03-31', 3)).toBe('2026-06-30');
	});
});

describe('result quality', () => {
	const q = statementsFrom({ get_quarterly_results: quarterly() }).quarterly;
	it('is in line when growth matches the trend', () => {
		const r = resultQuality(q, '2026-06-30');
		expect(r.verdict).toBe('in-line');
		expect(r.metrics[0].yoy).toBeCloseTo(10, 5);
		expect(r.metrics[0].trend).toBeCloseTo(10, 5);
	});
	it('is a beat when every metric grows well above its trend', () => {
		const s = [...sales]; s[8] = 160; // 45% YoY on sales against ~10% trend
		const t = statementsFrom({ get_quarterly_results: quarterly({ 'Sales +': s, 'Operating Profit': s.map((x) => x * 0.2), 'Net Profit +': s.map((x) => x * 0.1) }) }).quarterly;
		const r = resultQuality(t, '2026-06-30');
		expect(r.verdict).toBe('beat');
		expect(r.metrics.every((m) => m.verdict === 'beat')).toBe(true);
	});
	it('is a miss when profit falls while sales hold', () => {
		const t = statementsFrom({ get_quarterly_results: quarterly({ 'Operating Profit': sales.map((x, i) => (i === 8 ? x * 0.1 : x * 0.2)), 'Net Profit +': sales.map((x, i) => (i === 8 ? x * 0.04 : x * 0.1)) }) }).quarterly;
		const r = resultQuality(t, '2026-06-30');
		expect(r.metrics[0].verdict).toBe('in-line');
		expect(r.verdict).toBe('miss');
		expect(r.opmChange).toBeCloseTo(-10, 5);
	});
	it('says n/a without enough history, and skips a negative year-ago base', () => {
		expect(resultQuality(q, '2024-09-30').verdict).toBe('n/a');
		const loss = statementsFrom({ get_quarterly_results: quarterly({ 'Net Profit +': [-5, -5, -5, -5, -5, -5, -5, -5, 8] }) }).quarterly;
		const r = resultQuality(loss, '2026-06-30');
		expect(r.metrics[2].verdict).toBeNull();
		expect(r.verdict).toBe('in-line');
	});
	it('lists only quarters that have a year-ago column, newest first', () => {
		const all = allResultQuality(q);
		expect(all.map((x) => x.quarter)).toEqual(['2026-06-30', '2026-03-31', '2025-12-31', '2025-09-30', '2025-06-30']);
	});
});

describe('red flags', () => {
	const years = ['Mar 2024', 'Mar 2025', 'Mar 2026'];
	const stmt = (cfo: number[], pat: number[], extra: Record<string, number[]> = {}) => statementsFrom({
		get_financials_cash_flow: table(years, { 'Cash from Operating Activity +': cfo }),
		get_financials_profit_loss: table(years, { 'Net Profit +': pat, 'Other Income +': [5, 5, 5], 'Profit before tax': [40, 50, 60], ...Object.fromEntries(Object.entries(extra)) }),
		get_ratios: table(years, { 'Debtor Days': [60, 60, 60] })
	});
	it('CFO vs PAT passes on good conversion and fails on weak or negative cash flow', () => {
		const ok = cfoVsPat(stmt([30, 40, 50], [30, 40, 50]));
		expect(ok.status).toBe('pass');
		expect(ok.inputs.at(-1)).toEqual({ label: 'Cash conversion', value: '100%' });
		expect(cfoVsPat(stmt([5, 10, 15], [30, 40, 50])).status).toBe('fail');
		expect(cfoVsPat(stmt([40, 50, -3], [30, 40, 50])).detail).toMatch(/operating cash flow was negative/);
		expect(cfoVsPat(statementsFrom({})).status).toBe('na');
		expect(cfoVsPat(stmt([1, 1, 1], [-5, -5, -5])).status).toBe('na');
	});
	it('receivable days fail only on a sharp rise', () => {
		const days = (v: number[]) => statementsFrom({ get_ratios: table(years, { 'Debtor Days': v }) });
		expect(receivableDays(days([60, 62, 64])).status).toBe('pass');
		expect(receivableDays(days([60, 60, 90])).status).toBe('fail');
		expect(receivableDays(days([10, 10, 14])).status).toBe('pass'); // +40% but only 4 days
		expect(receivableDays(days([60, 60])).status).toBe('na');
	});
	it('other income share is judged against profit before tax', () => {
		const oi = (other: number[], pbt: number[]) => statementsFrom({ get_financials_profit_loss: table(years, { 'Other Income +': other, 'Profit before tax': pbt }) });
		expect(otherIncomeShare(oi([5, 5, 5], [40, 50, 60])).status).toBe('pass');
		const bad = otherIncomeShare(oi([5, 5, 30], [40, 50, 60]));
		expect(bad.status).toBe('fail');
		expect(bad.inputs.at(-1)?.value).toBe('50%');
		// A loss-making year with positive other income is itself the flag; with none there is nothing to judge.
		expect(otherIncomeShare(oi([5, 5, 3], [40, 50, -2]))).toMatchObject({ status: 'fail', detail: expect.stringMatching(/not positive/) });
		expect(otherIncomeShare(oi([5, 5, 0], [40, 50, 0])).status).toBe('na');
		expect(otherIncomeShare(statementsFrom({})).status).toBe('na');
	});
	it('promoter pledge', () => {
		expect(promoterPledge(null).status).toBe('na');
		expect(promoterPledge({ pledgedPct: null, period: 'Jun 2026' }).status).toBe('pass');
		expect(promoterPledge({ pledgedPct: 9.9, period: 'Jun 2026' }).status).toBe('pass');
		expect(promoterPledge({ pledgedPct: 10, period: 'Jun 2026' }).status).toBe('fail');
	});
	it('scores failed weight over evaluated weight and lists unavailable checks without scoring them', () => {
		const report = redFlagReport(stmt([5, 10, 15], [30, 40, 50]), { pledgedPct: 0, period: 'Jun 2026' });
		// CFO (3) fails; receivables (2, flat) pass; other income (2) pass; pledge (2) pass -> 3/9.
		expect(report.score).toBe(33);
		expect(report.level).toBe('watch');
		expect(report.failed).toBe(1);
		expect(report.checks.filter((c) => c.status === 'na').map((c) => c.id)).toEqual(['contingent', 'auditor', 'related_party']);
		expect(redFlagReport(statementsFrom({}), null).level).toBe('insufficient');
		expect(redFlagReport(stmt([30, 40, 50], [30, 40, 50]), { pledgedPct: 0, period: 'x' }).level).toBe('clean');
	});
});

describe('guidance matching', () => {
	const q = statementsFrom({ get_quarterly_results: quarterly() }).quarterly;
	const g = (over: Partial<GuidanceStatement>): GuidanceStatement => ({
		metric: 'revenue', label: 'Revenue', basis: 'growth_pct', comparator: 'at_least', target: 10, targetHigh: null, period: 'Q1 FY27', quote: 'q', ...over
	});
	it('reads period labels', () => {
		expect(periodQuarters('Q1 FY27')).toEqual(['2026-06-30']);
		expect(periodQuarters('Q4FY26')).toEqual(['2026-03-31']);
		expect(periodQuarters('H2 FY26')).toEqual(['2025-12-31', '2026-03-31']);
		expect(periodQuarters('FY27')).toEqual(['2026-06-30', '2026-09-30', '2026-12-31', '2027-03-31']);
		expect(periodQuarters('FY2026-27')?.length).toBe(4);
		expect(periodQuarters('next year')).toBeNull();
	});
	it('marks growth targets kept or missed against the reported quarter', () => {
		const kept = evaluateGuidance(g({ target: 9 }), q);
		expect(kept).toMatchObject({ status: 'kept', actualText: '10.0% growth' });
		expect(evaluateGuidance(g({ target: 20 }), q).status).toBe('missed');
		expect(evaluateGuidance(g({ target: 10.5 }), q).status).toBe('kept'); // within the 1 point tolerance
	});
	it('handles levels, margins, ranges and at_most', () => {
		expect(evaluateGuidance(g({ basis: 'level', target: 121, period: 'Q1 FY27' }), q).status).toBe('kept');
		expect(evaluateGuidance(g({ basis: 'level', target: 200, period: 'Q1 FY27' }), q).status).toBe('missed');
		expect(evaluateGuidance(g({ basis: 'level', target: 118, comparator: 'approx' }), q).status).toBe('kept'); // within 5%
		expect(evaluateGuidance(g({ metric: 'ebitda_margin', basis: 'margin_pct', target: 19.5 }), q)).toMatchObject({ status: 'kept', actualText: '20.0% margin' });
		expect(evaluateGuidance(g({ metric: 'ebitda_margin', basis: 'margin_pct', target: 25 }), q).status).toBe('missed');
		expect(evaluateGuidance(g({ basis: 'level', target: 100, targetHigh: 125, comparator: 'between' }), q).status).toBe('kept');
		expect(evaluateGuidance(g({ basis: 'level', target: 100, comparator: 'at_most' }), q).status).toBe('missed');
		expect(evaluateGuidance(g({ metric: 'pat', basis: 'level', target: 23, period: 'H1 FY26' }), q).status).toBe('kept'); // 11 + 12.1 = 23.1
		expect(evaluateGuidance(g({ metric: 'pat', basis: 'level', target: 30, period: 'H1 FY26' }), q).status).toBe('missed');
	});
	it('is pending for periods not yet reported and unverified when it cannot be measured', () => {
		expect(evaluateGuidance(g({ period: 'FY27' }), q)).toMatchObject({ status: 'pending' });
		expect(evaluateGuidance(g({ period: 'Q2 FY27' }), q).status).toBe('pending');
		expect(evaluateGuidance(g({ metric: 'other', label: 'Order book' }), q).status).toBe('unverified');
		expect(evaluateGuidance(g({ target: null }), q).status).toBe('unverified');
		expect(evaluateGuidance(g({ period: 'sometime' }), q).status).toBe('unverified');
		expect(evaluateGuidance(g({ metric: 'ebitda_margin', basis: 'growth_pct' }), q).status).toBe('unverified');
		expect(evaluateGuidance(g({ period: 'Q1 FY24' }), q).status).toBe('unverified'); // before the stored history
		expect(evaluateGuidance(g({}), undefined).status).toBe('pending');
	});
	it('computes a credibility history from resolved statements only', () => {
		expect(credibility([{ status: 'kept' }, { status: 'kept' }, { status: 'missed' }, { status: 'pending' }, { status: 'unverified' }])).toEqual({ kept: 2, resolved: 3, pct: 67 });
		expect(credibility([{ status: 'pending' }]).pct).toBeNull();
	});
});

describe('transcripts', () => {
	const page = (text: string) => ({ page: 1, text });
	it('reads the quarter from titles', () => {
		expect(quarterFromTitle('PICCADILY AGRO INDUSTRIES LTD FY2026-27 Q1 Transcript')).toBe('2026-06-30');
		expect(quarterFromTitle('ABC Q3 FY26 earnings call transcript')).toBe('2025-12-31');
		expect(quarterFromTitle('ABC FY26 Q4 Transcript')).toBe('2026-03-31');
		expect(quarterFromTitle('ABC Q2-FY2026 Transcript')).toBe('2025-09-30');
		expect(quarterFromTitle('Annual report')).toBeNull();
	});
	it('counts congratulations without matching other words', () => {
		expect(countCongratulations('Congratulations on the quarter. Congrats again; we congratulate you. Thanks.')).toBe(3);
		expect(countCongratulations('no such words')).toBe(0);
	});
	it('finds each transcript once, newest quarter first, and ignores presentations', () => {
		const sources = [
			{ id: 'a', title: 'X FY2026-27 Q1 Transcript', url: 'https://e/a', pages: [page('Congrats team. Revenue grew.')] },
			{ id: 'b', title: 'X FY2026-27 Q1 Presentation', url: 'https://e/b', pages: [page('slides')] },
			{ id: 'c', title: 'X FY2026-27 Q1 Transcript', url: 'https://e/c', pages: [page('Congrats  team.\nRevenue grew.')] }, // same text, different spacing
			{ id: 'd', title: 'X Q4 FY26 Transcript', url: 'https://e/d', pages: [page('Another call')] },
			{ id: 'e', title: 'Transcript with no quarter', url: 'https://e/e', pages: [page('Orphan')] }
		];
		const found = findTranscripts(sources);
		expect(found.map((t) => [t.sourceId, t.quarter, t.congratulations])).toEqual([['a', '2026-06-30', 1], ['d', '2026-03-31', 0]]);
		expect(findTranscripts(sources, '2025-12-31').length).toBe(3);
	});
});

describe('concall rows', () => {
	it('builds a row per transcript quarter plus the latest reported quarter, and flags unscanned companies', () => {
		const quality = allResultQuality(statementsFrom({ get_quarterly_results: quarterly() }).quarterly);
		const scan = {
			symbol: 'AAA', scannedAt: new Date(), quality, flags: null,
			transcripts: [{ sourceId: 'a', title: 'T', url: 'u', quarter: '2026-03-31', hash: 'h1', chars: 10, congratulations: 2 }]
		};
		const analysis = { transcriptHash: 'h1', result: { sentimentScore: 40, tone: 'confident' as const, positives: ['p'], negatives: ['n'], guidance: [], droppedGuidance: 0, truncated: false } };
		const { rows, unscanned } = buildConcallRows(
			[{ symbol: 'AAA', name: 'A Ltd', sector: 'S', subsector: '' }, { symbol: 'BBB', name: 'B Ltd', sector: 'S', subsector: '' }],
			[scan], [analysis], new Map([['AAA', { date: '2026-11-01', kind: 'Concall' }]])
		);
		expect(unscanned).toEqual(['BBB']);
		expect(rows.map((r) => [r.quarter, r.hasTranscript, r.analysed])).toEqual([['2026-06-30', false, false], ['2026-03-31', true, true]]);
		expect(rows[1]).toMatchObject({ sentiment: 40, tone: 'confident', congratulations: 2, next: { kind: 'Concall' } });
		expect(rows[0].congratulations).toBeNull();
		expect(quarterLabel('2026-06-30')).toBe('Q1 FY27');
		expect(quarterLabel('2026-03-31')).toBe('Q4 FY26');
	});
});

describe('row filters and sorting', async () => {
	const { filterRows, sortRows } = await import('./rows');
	const row = (over: object) => ({
		key: 'k', symbol: 'AAA', name: 'Alpha', sector: 'Tech', quarter: '2026-06-30', quality: null, hasTranscript: true, transcriptTitle: null, analysed: true,
		sentiment: null, tone: null, positives: [], negatives: [], guidanceCount: 0, congratulations: null, next: null, ...over
	}) as import('./rows').ConcallRow;
	const rows = [
		row({ symbol: 'AAA', name: 'Alpha', sentiment: 10, congratulations: 3, positives: ['Strong order book'] }),
		row({ symbol: 'BBB', name: 'Beta', sector: 'Pharma', sentiment: -20, quarter: '2026-03-31', quality: { verdict: 'miss', opm: 1, opmChange: 0, metrics: [] }, next: { date: '2026-11-01', kind: 'Concall' } }),
		row({ symbol: 'CCC', name: 'Gamma', sentiment: null, quality: { verdict: 'beat', opm: 1, opmChange: 0, metrics: [] }, next: { date: '2026-10-25', kind: 'Concall' } })
	];
	it('filters by search text, quarter, sector and watchlist symbols', () => {
		const base = { query: '', quarter: '', sector: '', symbols: null };
		expect(filterRows(rows, { ...base, query: 'order book' }).map((r) => r.symbol)).toEqual(['AAA']);
		expect(filterRows(rows, { ...base, quarter: '2026-03-31' }).map((r) => r.symbol)).toEqual(['BBB']);
		expect(filterRows(rows, { ...base, sector: 'Pharma' }).map((r) => r.symbol)).toEqual(['BBB']);
		expect(filterRows(rows, { ...base, symbols: new Set(['AAA', 'CCC']) }).map((r) => r.symbol)).toEqual(['AAA', 'CCC']);
	});
	it('sorts both ways with empty values always last', () => {
		expect(sortRows(rows, 'sentiment', 'desc').map((r) => r.symbol)).toEqual(['AAA', 'BBB', 'CCC']);
		expect(sortRows(rows, 'sentiment', 'asc').map((r) => r.symbol)).toEqual(['BBB', 'AAA', 'CCC']);
		expect(sortRows(rows, 'quality', 'desc').map((r) => r.symbol)).toEqual(['CCC', 'BBB', 'AAA']);
		expect(sortRows(rows, 'next', 'asc').map((r) => r.symbol)).toEqual(['CCC', 'BBB', 'AAA']);
		expect(sortRows(rows, 'company', 'desc').map((r) => r.symbol)).toEqual(['CCC', 'BBB', 'AAA']);
	});
});

describe('describeTarget', async () => {
	const { describeTarget } = await import('./guidance');
	it('reads naturally', () => {
		expect(describeTarget({ basis: 'growth_pct', comparator: 'at_least', target: 15, targetHigh: null, period: 'Q1 FY27' })).toBe('at least 15% growth in Q1 FY27');
		expect(describeTarget({ basis: 'level', comparator: 'between', target: 1200, targetHigh: 1300, period: 'FY27' })).toBe('between 1200 and 1300 Rs Cr in FY27');
	});
});
