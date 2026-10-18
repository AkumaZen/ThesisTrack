// Shapes stored scans, analyses and guidance into the rows the pages show. Pure.

import type { Verdict } from './resultQuality';
import { credibility } from './guidance';
import type { RedFlagReport } from './redFlags';
import type { ResultQuality } from './resultQuality';
import type { StoredAnalysis } from './analysis';
import type { TranscriptRef } from './transcripts';

export interface CompanyInfo { symbol: string; name: string; sector: string; subsector: string }
export interface ScanInfo { symbol: string; scannedAt: Date | string; quality: ResultQuality[]; flags: RedFlagReport | null; transcripts: TranscriptRef[] }
export interface AnalysisInfo { transcriptHash: string; result: StoredAnalysis }
export interface GuidanceInfo { symbol: string; status: string }
export interface UpcomingInfo { date: string; kind: string }

export interface ConcallRow {
	key: string;
	symbol: string;
	name: string;
	sector: string;
	quarter: string;
	quality: { verdict: Verdict | 'n/a'; opm: number | null; opmChange: number | null; metrics: ResultQuality['metrics'] } | null;
	hasTranscript: boolean;
	transcriptTitle: string | null;
	analysed: boolean;
	sentiment: number | null;
	tone: string | null;
	positives: string[];
	negatives: string[];
	guidanceCount: number;
	congratulations: number | null;
	next: UpcomingInfo | null;
}

export function buildConcallRows(
	companies: CompanyInfo[],
	scans: ScanInfo[],
	analyses: AnalysisInfo[],
	upcoming: Map<string, UpcomingInfo>
): { rows: ConcallRow[]; unscanned: string[] } {
	const scanBy = new Map(scans.map((s) => [s.symbol, s]));
	const byHash = new Map(analyses.map((a) => [a.transcriptHash, a.result]));
	const rows: ConcallRow[] = [];
	const unscanned: string[] = [];
	for (const c of companies) {
		const scan = scanBy.get(c.symbol);
		if (!scan) { unscanned.push(c.symbol); continue; }
		// A row for every quarter with a stored transcript, plus the latest reported quarter.
		const quarters = new Set(scan.transcripts.map((t) => t.quarter));
		if (scan.quality[0]) quarters.add(scan.quality[0].quarter);
		for (const quarter of [...quarters].sort().reverse()) {
			const q = scan.quality.find((x) => x.quarter === quarter) ?? null;
			const t = scan.transcripts.find((x) => x.quarter === quarter) ?? null;
			const a = t ? byHash.get(t.hash) ?? null : null;
			rows.push({
				key: `${c.symbol}:${quarter}`, symbol: c.symbol, name: c.name, sector: c.sector, quarter,
				quality: q ? { verdict: q.verdict, opm: q.opm, opmChange: q.opmChange, metrics: q.metrics } : null,
				hasTranscript: !!t, transcriptTitle: t?.title ?? null, analysed: !!a,
				sentiment: a?.sentimentScore ?? null, tone: a?.tone ?? null,
				positives: a?.positives ?? [], negatives: a?.negatives ?? [], guidanceCount: a?.guidance.length ?? 0,
				congratulations: t ? t.congratulations : null,
				next: upcoming.get(c.symbol) ?? null
			});
		}
	}
	return { rows, unscanned };
}

export interface RedFlagListRow {
	symbol: string;
	name: string;
	sector: string;
	score: number | null;
	level: RedFlagReport['level'];
	failed: string[];
	passed: number;
	na: number;
	credibilityPct: number | null;
	resolved: number;
	scannedAt: string;
}

export function buildRedFlagRows(companies: CompanyInfo[], scans: ScanInfo[], guidance: GuidanceInfo[]): { rows: RedFlagListRow[]; unscanned: string[] } {
	const scanBy = new Map(scans.map((s) => [s.symbol, s]));
	const rows: RedFlagListRow[] = [];
	const unscanned: string[] = [];
	for (const c of companies) {
		const scan = scanBy.get(c.symbol);
		if (!scan?.flags) { unscanned.push(c.symbol); continue; }
		const cred = credibility(guidance.filter((g) => g.symbol === c.symbol));
		rows.push({
			symbol: c.symbol, name: c.name, sector: c.sector, score: scan.flags.score, level: scan.flags.level,
			failed: scan.flags.checks.filter((k) => k.status === 'fail').map((k) => k.name),
			passed: scan.flags.checks.filter((k) => k.status === 'pass').length,
			na: scan.flags.checks.filter((k) => k.status === 'na').length,
			credibilityPct: cred.pct, resolved: cred.resolved, scannedAt: new Date(scan.scannedAt).toISOString()
		});
	}
	return { rows, unscanned };
}

export const VERDICT_LABEL: Record<string, string> = { beat: 'Beat', 'in-line': 'In line', miss: 'Miss', 'n/a': 'n/a' };
export const quarterLabel = (date: string) => {
	const month = +date.slice(5, 7), year = +date.slice(0, 4);
	const fy = month > 3 ? year + 1 : year;
	const q = ({ 6: 1, 9: 2, 12: 3, 3: 4 } as Record<number, number>)[month];
	return q ? `Q${q} FY${String(fy).slice(2)}` : date;
};
