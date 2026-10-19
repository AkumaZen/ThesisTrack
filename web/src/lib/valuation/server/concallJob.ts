import { env } from '$env/dynamic/private';
import * as cheerio from 'cheerio';
import { allResultQuality } from '../concall/resultQuality';
import { redFlagReport } from '../concall/redFlags';
import { statementsFrom, type Statements } from '../concall/financials';
import { evaluateGuidance, type GuidanceStatement } from '../concall/guidance';
import { AnalysisError, MAX_TRANSCRIPT_CHARS, PROMPT_VERSION, callModel, parseAnalysis } from '../concall/analysis';
import { findTranscripts, transcriptHash, transcriptText, type StoredSource } from '../concall/transcripts';
import { fetchScreenerPage, screenerTable } from './trackerFinancials';
import * as store from './concallStore';

/** Most transcripts one run may send to the model. Each is one call of up to MAX_TRANSCRIPT_CHARS characters. */
export const MAX_ANALYSES_PER_RUN = 5;
/** Stop starting new analyses after this long, so the request ends inside the function time limit. */
const TIME_BUDGET_MS = 200_000;
/** Quarters of results shown per company. */
const QUALITY_QUARTERS = 8;

const KEYS = ['get_quarterly_results', 'get_financials_profit_loss', 'get_financials_balance_sheet', 'get_financials_cash_flow', 'get_ratios'] as const;

/** Screener's statements as the Master Tracker stored them, taken from the newest research row that has them. */
function storedFinancials(rows: { sources: StoredSource[] }[]): Record<string, unknown> | null {
	const raw: Record<string, unknown> = {};
	for (const row of rows) {
		for (const source of row.sources) {
			const key = source.id.replace(/^screener-/, '');
			if ((KEYS as readonly string[]).includes(key) && !(key in raw) && source.pages[0]) raw[key] = source.pages[0].text;
		}
	}
	return 'get_quarterly_results' in raw ? raw : null;
}

async function liveFinancials(symbol: string): Promise<Record<string, unknown>> {
	const { result, html } = await fetchScreenerPage(symbol);
	return {
		get_quarterly_results: result.get_quarterly_results,
		get_financials_profit_loss: result.get_financials_profit_loss,
		get_financials_balance_sheet: result.get_financials_balance_sheet,
		get_financials_cash_flow: result.get_financials_cash_flow,
		get_ratios: screenerTable(cheerio.load(html), 'ratios')
	};
}

/** Re-checks every guidance statement of a company against the stored results. No model call. */
async function reevaluate(symbol: string, statements: Statements) {
	const rows = await store.listGuidance(symbol);
	await store.saveEvaluations(rows.map((r) => ({
		id: r.id,
		evaluation: evaluateGuidance({ metric: r.metric, label: r.label, basis: r.basis, comparator: r.comparator, target: r.target, targetHigh: r.targetHigh, period: r.period, quote: r.quote } as GuidanceStatement, statements.quarterly)
	})));
}

/**
 * Refreshes one company: fetches Screener (falling back to the last snapshot, then to the Master
 * Tracker's research), recomputes result quality and red flags, indexes the stored transcripts and
 * re-checks guidance. Never calls the model.
 */
export async function refreshCompany(symbol: string, fetchLive: (symbol: string) => Promise<Record<string, unknown>> = liveFinancials): Promise<{ finSource: string; transcripts: number }> {
	const research = await store.researchSources(symbol);
	const previous = await store.getScan(symbol);
	let financials: Record<string, unknown> | null = null, finSource = 'screener', financialsAt: Date | null = new Date();
	try {
		financials = await fetchLive(symbol);
	} catch {
		if (previous?.financials) { financials = previous.financials; finSource = 'stored'; financialsAt = previous.financialsAt; }
		else { financials = storedFinancials(research); finSource = 'research'; financialsAt = null; }
	}
	if (!financials) throw new Error('No financial statements are stored for this company yet. Load its research in the Master Tracker first.');
	const statements = statementsFrom(financials);
	const quarters = research.length === 1 ? research[0].key.split(':')[1]?.split(',') : undefined;
	const transcripts = findTranscripts(research.flatMap((r) => r.sources), quarters?.length === 1 && /^\d{4}-/.test(quarters[0]) ? quarters[0] : undefined);
	await store.saveScan({
		symbol, finSource, financials, financialsAt,
		quality: allResultQuality(statements.quarterly).slice(0, QUALITY_QUARTERS),
		flags: redFlagReport(statements, await store.pledgeFor(symbol)),
		transcripts
	});
	await reevaluate(symbol, statements);
	return { finSource, transcripts: transcripts.length };
}

export interface RefreshOutcome { done: string[]; failed: { symbol: string; message: string }[]; remaining: number }

/** Refreshes up to `limit` companies: never scanned first, then the stalest. `symbols` limits the candidates. */
export async function refreshBatch(limit: number, symbols?: string[], fetchLive?: (symbol: string) => Promise<Record<string, unknown>>): Promise<RefreshOutcome> {
	const companies = (await store.listCompanies()).map((c) => c.symbol).filter((s) => !symbols || symbols.includes(s));
	const scans = new Map((await store.listScans()).map((s) => [s.symbol, s.scannedAt.getTime()]));
	const staleBefore = Date.now() - (symbols ? 0 : 6 * 3600_000);
	const due = companies.filter((s) => (scans.get(s) ?? 0) < staleBefore).sort((a, b) => (scans.get(a) ?? 0) - (scans.get(b) ?? 0));
	const out: RefreshOutcome = { done: [], failed: [], remaining: Math.max(0, due.length - limit) };
	for (const symbol of due.slice(0, limit)) {
		try { await refreshCompany(symbol, fetchLive); out.done.push(symbol); }
		catch (e) { out.failed.push({ symbol, message: e instanceof Error ? e.message : 'Refresh failed.' }); }
	}
	return out;
}

export function modelConfig() {
	return { key: env.OPEN_AI_KEY || env.OPENAI_API_KEY || '', model: env.OPENAI_MODEL || 'gpt-5.6-luna' };
}

export interface AnalyseOutcome {
	analysed: { symbol: string; quarter: string; inputTokens: number; outputTokens: number; guidance: number }[];
	cached: number;
	failed: { symbol: string; quarter: string; message: string }[];
	/** Transcripts still waiting for analysis after this run. */
	remaining: number;
}

/** Transcripts of the scanned companies that have no analysis for the current prompt version yet. */
export async function pendingTranscripts(symbols?: string[]) {
	const scans = (await store.listScans()).filter((s) => !symbols || symbols.includes(s.symbol));
	const done = new Set((await store.listAnalyses()).filter((a) => a.promptVersion === PROMPT_VERSION).map((a) => a.transcriptHash));
	return scans.flatMap((s) => s.transcripts.filter((t) => !done.has(t.hash)).map((t) => ({ symbol: s.symbol, ref: t })))
		.sort((a, b) => b.ref.quarter.localeCompare(a.ref.quarter) || a.symbol.localeCompare(b.symbol));
}

/**
 * Sends the newest un-analysed transcripts to the model, at most `limit` (never more than
 * MAX_ANALYSES_PER_RUN). Safe to repeat: finished transcripts are cached by content hash, so a
 * second run continues where the first stopped and never pays twice for the same text.
 */
export async function analyseBatch(limit: number, symbols?: string[], fetchImpl?: typeof fetch): Promise<AnalyseOutcome> {
	const { key, model } = modelConfig();
	if (!key) throw new AnalysisError('OPEN_AI_KEY is not configured.');
	const queue = await pendingTranscripts(symbols);
	const take = queue.slice(0, Math.max(0, Math.min(limit, MAX_ANALYSES_PER_RUN)));
	const out: AnalyseOutcome = { analysed: [], cached: 0, failed: [], remaining: 0 };
	const started = Date.now();
	const sourcesBySymbol = new Map<string, StoredSource[]>();
	let handled = 0;
	for (const { symbol, ref } of take) {
		if (Date.now() - started > TIME_BUDGET_MS) break;
		handled++;
		try {
			if (await store.findAnalysis(ref.hash, PROMPT_VERSION)) { out.cached++; continue; }
			if (!sourcesBySymbol.has(symbol)) sourcesBySymbol.set(symbol, (await store.researchSources(symbol)).flatMap((r) => r.sources));
			const source = sourcesBySymbol.get(symbol)!.find((s) => /transcript/i.test(s.title) && transcriptHash(transcriptText(s)) === ref.hash);
			if (!source) throw new AnalysisError('The stored transcript is no longer in the Master Tracker research. Refresh the company.');
			const text = transcriptText(source);
			const { output, usage } = await callModel(text, { symbol, quarterLabel: ref.quarter }, { key, model, fetchImpl });
			const result = parseAnalysis(output, source.pages, text.length > MAX_TRANSCRIPT_CHARS);
			await store.saveAnalysis({ hash: ref.hash, promptVersion: PROMPT_VERSION, symbol, quarter: ref.quarter, sourceTitle: ref.title, model, result, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens });
			const scan = await store.getScan(symbol);
			if (scan?.financials) await reevaluate(symbol, statementsFrom(scan.financials));
			out.analysed.push({ symbol, quarter: ref.quarter, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, guidance: result.guidance.length });
		} catch (e) {
			out.failed.push({ symbol, quarter: ref.quarter, message: e instanceof AnalysisError ? e.message : e instanceof Error && e.name === 'ZodError' ? 'The model returned an unexpected format.' : 'The analysis failed. Try again.' });
		}
	}
	out.remaining = queue.length - handled + out.failed.length;
	return out;
}
