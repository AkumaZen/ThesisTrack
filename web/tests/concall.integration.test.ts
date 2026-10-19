// DB-backed run of the concall pipeline with a fake model: refresh from stored research, one model
// call per transcript (cached by content hash afterwards), quote verification, failure handling and
// guidance verdicts against the stored results. The OpenAI endpoint is a stub; nothing leaves the machine.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '../src/lib/server/db';
import { concallAnalyses, concallGuidance, masterTrackerCompanies, masterTrackerResearch, concallCompanyScan } from '../src/lib/server/db/valuationSchema';
import { analyseBatch, MAX_ANALYSES_PER_RUN, pendingTranscripts, refreshBatch, refreshCompany } from '../src/lib/valuation/server/concallJob';
import { PROMPT_VERSION } from '../src/lib/valuation/concall/analysis';
import * as store from '../src/lib/valuation/server/concallStore';
import { dbReachable } from './dbReachable';

const dbUp = await dbReachable();
const SYMBOL = `VICC${Date.now()}`;
process.env.OPEN_AI_KEY ||= 'test-key';

const QUARTERS = ['Jun 2024', 'Sep 2024', 'Dec 2024', 'Mar 2025', 'Jun 2025', 'Sep 2025', 'Dec 2025', 'Mar 2026', 'Jun 2026'];
const SALES = [100, 110, 120, 130, 110, 121, 132, 143, 121];
const tbl = (years: string[], rows: Record<string, number[]>) => ({ years, rows: Object.entries(rows).map(([label, values]) => ({ label, values: values.map(String) })) });
const src = (id: string, value: unknown) => ({ id, title: id, url: 'https://www.screener.in/', pages: [{ page: null, text: JSON.stringify(value) }] });

const CALL_Q1 = 'Thank you all. We expect revenue growth of at least 15% in Q1 FY26. Congratulations on the margins, said one analyst. Our margin should be about 20% for FY26.';
const CALL_Q2 = 'We are confident. We will grow revenue by 12% in Q2 FY26 and keep a very bright outlook for the year.';
const research = {
	quarters: [], warnings: [], fetchedAt: Date.now(),
	sources: [
		src('screener-get_quarterly_results', tbl(QUARTERS, { 'Sales +': SALES, 'Operating Profit': SALES.map((s) => s * 0.2), 'Net Profit +': SALES.map((s) => s * 0.1) })),
		src('screener-get_financials_profit_loss', tbl(['Mar 2024', 'Mar 2025', 'Mar 2026'], { 'Net Profit +': [30, 40, 50], 'Other Income +': [5, 5, 5], 'Profit before tax': [40, 50, 60] })),
		src('screener-get_financials_cash_flow', tbl(['Mar 2024', 'Mar 2025', 'Mar 2026'], { 'Cash from Operating Activity +': [30, 40, 50] })),
		{ id: 'doc-1', title: 'VICC FY2025-26 Q1 Transcript', url: 'https://example.com/q1.pdf', pages: [{ page: 1, text: CALL_Q1 }] },
		{ id: 'doc-2', title: 'VICC FY2025-26 Q2 Transcript', url: 'https://example.com/q2.pdf', pages: [{ page: 1, text: CALL_Q2 }] }
	]
};

const answer = (body: unknown, usage = { input_tokens: 1000, output_tokens: 200 }) =>
	new Response(JSON.stringify({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(body) }] }], usage }), { status: 200 });
const noLive = async () => { throw new Error('offline'); };

describe.skipIf(!dbUp)('concall pipeline', () => {
	beforeAll(async () => {
		await db.insert(masterTrackerCompanies).values({ symbol: SYMBOL, state: { name: 'Vitest Concall Ltd', sector: 'Testing', subsector: '' }, version: 1 });
		await db.insert(masterTrackerResearch).values({ key: `${SYMBOL}:2025-06-30,2025-09-30`, symbol: SYMBOL, data: research });
	});
	afterAll(async () => {
		await db.delete(masterTrackerCompanies).where(eq(masterTrackerCompanies.symbol, SYMBOL)); // cascades to every concall table
	});

	it('refreshes from the stored research when Screener is unreachable, computing quality, flags and transcripts', async () => {
		const result = await refreshCompany(SYMBOL, noLive);
		expect(result).toEqual({ finSource: 'research', transcripts: 2 });
		const scan = (await store.listScans()).find((s) => s.symbol === SYMBOL)!;
		expect(scan.transcripts.map((t) => [t.quarter, t.congratulations])).toEqual([['2025-09-30', 0], ['2025-06-30', 1]]);
		expect(scan.quality[0]).toMatchObject({ quarter: '2026-06-30', verdict: 'in-line' });
		expect(scan.flags?.checks.find((c) => c.id === 'cfo_pat')?.status).toBe('pass');
		expect(scan.flags?.checks.find((c) => c.id === 'receivables')?.status).toBe('na'); // no ratios stored
	});

	it('refreshBatch only touches the requested symbols, and skips none that were never scanned', async () => {
		const out = await refreshBatch(5, [SYMBOL], noLive);
		expect(out).toEqual({ done: [SYMBOL], failed: [], remaining: 0 });
	});

	it('analyses each transcript once: parses, verifies quotes, scores guidance and records tokens', async () => {
		let calls = 0;
		const fake = (async (_url: unknown, init?: { body?: unknown }) => {
			calls++;
			const q1 = String(init?.body).includes('We expect revenue growth');
			return answer(q1
				? { sentimentScore: 55, tone: 'confident', positives: ['Margin strength'], negatives: ['Raw material cost'],
					guidance: [
						{ metric: 'revenue', label: 'Revenue growth', basis: 'growth_pct', comparator: 'at_least', target: 15, targetHigh: null, period: 'Q1 FY26', quote: 'We expect revenue growth of at least 15% in Q1 FY26' },
						{ metric: 'ebitda_margin', label: 'EBITDA margin', basis: 'margin_pct', comparator: 'approx', target: 20, targetHigh: null, period: 'FY26', quote: 'Our margin should be about 20% for FY26' },
						{ metric: 'revenue', label: 'Invented', basis: 'growth_pct', comparator: 'at_least', target: 99, targetHigh: null, period: 'FY26', quote: 'This sentence is not in the call' }
					] }
				: { sentimentScore: 30, tone: 'optimistic', positives: [], negatives: [], guidance: [
					{ metric: 'revenue', label: 'Revenue growth', basis: 'growth_pct', comparator: 'approx', target: 12, targetHigh: null, period: 'Q2 FY26', quote: 'We will grow revenue by 12% in Q2 FY26' }] },
				{ input_tokens: 1500, output_tokens: 300 });
		}) as unknown as typeof fetch;

		expect((await pendingTranscripts([SYMBOL])).length).toBe(2);
		const first = await analyseBatch(5, [SYMBOL], fake);
		expect(first.failed).toEqual([]);
		expect(first.analysed.map((a) => [a.quarter, a.guidance, a.inputTokens, a.outputTokens])).toEqual([['2025-09-30', 1, 1500, 300], ['2025-06-30', 2, 1500, 300]]);
		expect(first.remaining).toBe(0);
		expect(calls).toBe(2);

		const rows = await db.select().from(concallAnalyses).where(eq(concallAnalyses.symbol, SYMBOL));
		expect(rows.length).toBe(2);
		const q1 = rows.find((r) => r.quarter === '2025-06-30')!;
		expect(q1.promptVersion).toBe(PROMPT_VERSION);
		expect((q1.result as { droppedGuidance: number }).droppedGuidance).toBe(1);

		// Guidance verdicts come from the stored results: Q1 FY26 revenue grew 10% against a 15% target.
		const g = await store.listGuidance(SYMBOL);
		const byLabel = (quarter: string, label: string) => g.find((x) => x.quarter === quarter && x.label === label)!;
		expect(byLabel('2025-06-30', 'Revenue growth')).toMatchObject({ status: 'missed', actualText: '10.0% growth' });
		expect(byLabel('2025-06-30', 'EBITDA margin')).toMatchObject({ status: 'kept' }); // FY26 margin is 20%
		expect(byLabel('2025-09-30', 'Revenue growth')).toMatchObject({ status: 'missed' }); // 10% growth against about 12% (tolerance 1 point)
		expect(g.every((x) => x.page === 1)).toBe(true);
	});

	it('does not call the model again for cached transcripts', async () => {
		let calls = 0;
		const fake = (async () => { calls++; return answer({}); }) as unknown as typeof fetch;
		const again = await analyseBatch(5, [SYMBOL], fake);
		expect(again).toEqual({ analysed: [], cached: 0, failed: [], remaining: 0 });
		expect(calls).toBe(0);
		expect((await db.select().from(concallAnalyses).where(eq(concallAnalyses.symbol, SYMBOL))).length).toBe(2);
	});

	it('re-checks guidance for free when new results arrive', async () => {
		const scan = (await store.getScan(SYMBOL))!;
		const financials = { ...scan.financials } as Record<string, unknown>;
		// Pretend Q1 FY26 sales were 120 (not 110): growth now 20%, which meets the 15% target.
		const better = [...SALES]; better[4] = 120;
		financials.get_quarterly_results = tbl(QUARTERS, { 'Sales +': better, 'Operating Profit': better.map((s) => s * 0.2), 'Net Profit +': better.map((s) => s * 0.1) });
		const live = async () => financials;
		await refreshCompany(SYMBOL, live);
		const g = await store.listGuidance(SYMBOL);
		expect(g.find((x) => x.quarter === '2025-06-30' && x.label === 'Revenue growth')).toMatchObject({ status: 'kept', actualText: '20.0% growth' });
	});

	it('reports a failure without saving, and leaves the transcript pending for the next run', async () => {
		await db.delete(concallAnalyses).where(eq(concallAnalyses.symbol, SYMBOL));
		const down = (async () => new Response('nope', { status: 500 })) as unknown as typeof fetch;
		const out = await analyseBatch(1, [SYMBOL], down);
		expect(out.analysed).toEqual([]);
		expect(out.failed).toHaveLength(1);
		expect(out.failed[0].message).toMatch(/HTTP 500/);
		expect(out.remaining).toBe(2);
		const junk = (async () => answer({ sentimentScore: 500, tone: 'wild', positives: [], negatives: [], guidance: [] })) as unknown as typeof fetch;
		const bad = await analyseBatch(1, [SYMBOL], junk);
		expect(bad.failed[0].message).toMatch(/unexpected format/);
		expect(await db.select().from(concallAnalyses).where(eq(concallAnalyses.symbol, SYMBOL))).toEqual([]);
		expect(await db.select().from(concallGuidance).where(eq(concallGuidance.symbol, SYMBOL))).toEqual([]);
	});

	it('never sends more than the per-run cap, however many are asked for', async () => {
		let calls = 0;
		const fake = (async () => { calls++; return answer({ sentimentScore: 0, tone: 'neutral', positives: [], negatives: [], guidance: [] }); }) as unknown as typeof fetch;
		const out = await analyseBatch(50, [SYMBOL], fake);
		expect(calls).toBeLessThanOrEqual(MAX_ANALYSES_PER_RUN);
		expect(out.analysed.length).toBe(2);
	});

	it('handles a company with no stored transcript', async () => {
		await db.update(masterTrackerResearch).set({ data: { ...research, sources: research.sources.filter((s) => !/Transcript/.test(s.title)) } }).where(eq(masterTrackerResearch.symbol, SYMBOL));
		expect((await refreshCompany(SYMBOL, noLive)).transcripts).toBe(0);
		const scan = await db.select().from(concallCompanyScan).where(eq(concallCompanyScan.symbol, SYMBOL));
		expect(scan[0].transcripts).toEqual([]);
	});
});
