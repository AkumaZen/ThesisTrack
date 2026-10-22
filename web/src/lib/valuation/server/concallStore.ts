import { and, asc, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import {
	announcements,
	boardMeetings,
	concallAnalyses,
	concallCompanyScan,
	concallGuidance,
	masterTrackerResearch,
	savedValuations,
	shareholdingSnapshots
} from '$lib/server/db/valuationSchema';
import type { RedFlagReport } from '../concall/redFlags';
import type { ResultQuality } from '../concall/resultQuality';
import type { StoredAnalysis } from '../concall/analysis';
import type { GuidanceEvaluation } from '../concall/guidance';
import type { StoredSource, TranscriptRef } from '../concall/transcripts';
import { parseMeetingDate } from '../boardMeetings';
import { listSections } from './marketIntelStore';

export interface TrackedCompany { symbol: string; name: string; sector: string; subsector: string }

/** Tracked companies, reading only the identity fields out of the Master Tracker state. */
export async function listCompanies(): Promise<TrackedCompany[]> {
	const rows = await db.execute<{ symbol: string; name: string | null; sector: string | null; subsector: string | null }>(
		sql`SELECT symbol, state->>'name' AS name, state->>'sector' AS sector, state->>'subsector' AS subsector FROM valuation.master_tracker_companies ORDER BY symbol`
	);
	return rows.map((r) => ({ symbol: r.symbol, name: r.name ?? r.symbol, sector: r.sector ?? '', subsector: r.subsector ?? '' }));
}

export interface ScanSummary {
	symbol: string;
	scannedAt: Date;
	finSource: string;
	financialsAt: Date | null;
	quality: ResultQuality[];
	flags: RedFlagReport | null;
	transcripts: TranscriptRef[];
}

const summaryColumns = {
	symbol: concallCompanyScan.symbol,
	scannedAt: concallCompanyScan.scannedAt,
	finSource: concallCompanyScan.finSource,
	financialsAt: concallCompanyScan.financialsAt,
	quality: concallCompanyScan.quality,
	flags: concallCompanyScan.flags,
	transcripts: concallCompanyScan.transcripts
};
const asSummary = (r: typeof concallCompanyScan.$inferSelect | { [K in keyof typeof summaryColumns]: unknown }) => r as unknown as ScanSummary;

export async function listScans(): Promise<ScanSummary[]> {
	return (await db.select(summaryColumns).from(concallCompanyScan)).map(asSummary);
}

export async function getScan(symbol: string): Promise<(ScanSummary & { financials: Record<string, unknown> | null }) | null> {
	const [row] = await db.select().from(concallCompanyScan).where(eq(concallCompanyScan.symbol, symbol));
	return row ? (row as unknown as ScanSummary & { financials: Record<string, unknown> | null }) : null;
}

export async function saveScan(scan: Omit<ScanSummary, 'scannedAt'> & { financials: Record<string, unknown> | null }) {
	const values = { ...scan, scannedAt: new Date() };
	await db.insert(concallCompanyScan).values(values).onConflictDoUpdate({ target: concallCompanyScan.symbol, set: values });
}

/** The Master Tracker's stored research rows for a company (large: used one company at a time). */
export async function researchSources(symbol: string): Promise<{ key: string; sources: StoredSource[] }[]> {
	const rows = await db.select().from(masterTrackerResearch).where(eq(masterTrackerResearch.symbol, symbol));
	return rows.map((r) => ({ key: r.key, sources: ((r.data as { sources?: StoredSource[] }).sources ?? []) }));
}

export async function pledgeFor(symbol: string) {
	const [row] = await db.select().from(shareholdingSnapshots).where(eq(shareholdingSnapshots.nseSymbol, symbol));
	return row ? { pledgedPct: row.pledgedPct, period: row.period } : null;
}

// ---- analyses and guidance ----

export type AnalysisRow = Omit<typeof concallAnalyses.$inferSelect, 'result'> & { result: StoredAnalysis };

export async function findAnalysis(hash: string, promptVersion: number): Promise<AnalysisRow | null> {
	const [row] = await db.select().from(concallAnalyses)
		.where(and(eq(concallAnalyses.transcriptHash, hash), eq(concallAnalyses.promptVersion, promptVersion)));
	return (row as AnalysisRow | undefined) ?? null;
}

export async function listAnalyses(symbol?: string): Promise<AnalysisRow[]> {
	const q = db.select().from(concallAnalyses);
	const rows = symbol ? await q.where(eq(concallAnalyses.symbol, symbol)).orderBy(desc(concallAnalyses.quarter)) : await q;
	return rows as AnalysisRow[];
}

export interface NewAnalysis {
	hash: string; promptVersion: number; symbol: string; quarter: string; sourceTitle: string; model: string;
	result: StoredAnalysis; inputTokens: number; outputTokens: number;
}

/** Saves an analysis and its guidance rows; false when another run saved the same transcript first. */
export async function saveAnalysis(a: NewAnalysis): Promise<boolean> {
	return db.transaction(async (tx) => {
		const [row] = await tx.insert(concallAnalyses).values({
			transcriptHash: a.hash, promptVersion: a.promptVersion, symbol: a.symbol, quarter: a.quarter, sourceTitle: a.sourceTitle,
			model: a.model, result: a.result, inputTokens: a.inputTokens, outputTokens: a.outputTokens
		}).onConflictDoNothing().returning({ id: concallAnalyses.id });
		if (!row) return false;
		if (a.result.guidance.length) {
			await tx.insert(concallGuidance).values(a.result.guidance.map((g) => ({
				analysisId: row.id, symbol: a.symbol, quarter: a.quarter, metric: g.metric, label: g.label, basis: g.basis,
				comparator: g.comparator, target: g.target, targetHigh: g.targetHigh, period: g.period, quote: g.quote, page: g.page
			})));
		}
		return true;
	});
}

export type GuidanceRow = typeof concallGuidance.$inferSelect;

export async function listGuidance(symbol?: string): Promise<GuidanceRow[]> {
	const q = db.select().from(concallGuidance);
	return symbol ? q.where(eq(concallGuidance.symbol, symbol)).orderBy(desc(concallGuidance.quarter), asc(concallGuidance.id)) : q;
}

export async function saveEvaluations(updates: { id: number; evaluation: GuidanceEvaluation }[]) {
	const now = new Date();
	for (const { id, evaluation: e } of updates) {
		await db.update(concallGuidance).set({ status: e.status, actual: e.actual, actualText: e.actualText, statusReason: e.reason, evaluatedAt: now })
			.where(eq(concallGuidance.id, id));
	}
}

// ---- watchlists and upcoming dates ----

export interface WatchlistOption { id: string; name: string; symbols: string[] }

/** The main watchlist plus the person's own lists (watchlist sections), as symbol sets for the filter. */
export async function listWatchlistOptions(userId: number): Promise<WatchlistOption[]> {
	const [main, sections] = await Promise.all([
		db.select({ symbol: savedValuations.symbol }).from(savedValuations),
		listSections(userId)
	]);
	return [
		{ id: 'main', name: 'Main watchlist', symbols: main.map((m) => m.symbol) },
		...sections.map((w) => ({ id: String(w.id), name: w.name, symbols: w.items.map((i) => i.nseSymbol) }))
	];
}

export interface UpcomingCall { date: string; kind: 'Concall' | 'Results meeting' }
const CONCALL_TEXT = /(earnings|conference|analyst|investor)[\s\w-]{0,20}(call|meet)|con-?call/i;

/**
 * The next concall date per symbol: a concall intimation in the announcements we stored if one gives
 * a future date, else the next results board meeting from the results calendar.
 */
export async function upcomingCalls(symbols: string[], today: string): Promise<Map<string, UpcomingCall>> {
	const out = new Map<string, UpcomingCall>();
	if (!symbols.length) return out;
	const since = new Date(Date.now() - 45 * 86400000);
	const [intimations, meetings] = await Promise.all([
		db.select({ symbol: announcements.nseSymbol, subject: announcements.subject, details: announcements.details, announcedAt: announcements.announcedAt })
			.from(announcements).where(and(inArray(announcements.nseSymbol, symbols), gte(announcements.announcedAt, since))),
		db.select({ symbol: boardMeetings.nseSymbol, date: boardMeetings.meetingDate }).from(boardMeetings)
			.where(and(inArray(boardMeetings.nseSymbol, symbols), gte(boardMeetings.meetingDate, today), eq(boardMeetings.isResults, true)))
			.orderBy(asc(boardMeetings.meetingDate))
	]);
	for (const m of meetings) if (!out.has(m.symbol)) out.set(m.symbol, { date: m.date, kind: 'Results meeting' });
	for (const a of intimations) {
		const text = `${a.subject} ${a.details}`;
		if (!CONCALL_TEXT.test(text)) continue;
		const date = parseMeetingDate(text, a.announcedAt);
		if (!date || date < today) continue;
		const known = out.get(a.symbol);
		if (!known || known.kind === 'Results meeting' || date < known.date) out.set(a.symbol, { date, kind: 'Concall' });
	}
	return out;
}
