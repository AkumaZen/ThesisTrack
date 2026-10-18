import { istDay } from '../boardMeetings';
import { buildConcallRows, type ConcallRow } from '../concall/rows';
import { credibility } from '../concall/guidance';
import { PROMPT_VERSION } from '../concall/analysis';
import * as store from './concallStore';

export interface PanelData {
	company: store.TrackedCompany;
	scannedAt: string | null;
	finSource: string | null;
	flags: Awaited<ReturnType<typeof store.listScans>>[number]['flags'];
	calls: ConcallRow[];
	guidance: (Omit<store.GuidanceRow, 'evaluatedAt'> & { evaluatedAt: string | null })[];
	credibility: ReturnType<typeof credibility>;
	pending: number;
	tokens: { input: number; output: number };
}

/** Everything the per-company panel shows, from stored data only (no network, no model). */
export async function companyPanel(symbol: string): Promise<PanelData | null> {
	const company = (await store.listCompanies()).find((c) => c.symbol === symbol);
	if (!company) return null;
	const [scan] = (await store.listScans()).filter((s) => s.symbol === symbol);
	const [analyses, guidance, upcoming] = await Promise.all([store.listAnalyses(symbol), store.listGuidance(symbol), store.upcomingCalls([symbol], istDay(new Date()))]);
	const current = analyses.filter((a) => a.promptVersion === PROMPT_VERSION);
	const calls = scan ? buildConcallRows([company], [scan], current, upcoming).rows : [];
	return {
		company,
		scannedAt: scan ? new Date(scan.scannedAt).toISOString() : null,
		finSource: scan?.finSource ?? null,
		flags: scan?.flags ?? null,
		calls,
		guidance: guidance.map((g) => ({ ...g, evaluatedAt: g.evaluatedAt ? g.evaluatedAt.toISOString() : null })),
		credibility: credibility(guidance),
		pending: scan ? scan.transcripts.filter((t) => !current.some((a) => a.transcriptHash === t.hash)).length : 0,
		tokens: { input: analyses.reduce((n, a) => n + a.inputTokens, 0), output: analyses.reduce((n, a) => n + a.outputTokens, 0) }
	};
}
