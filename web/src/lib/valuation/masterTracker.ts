import { z } from 'zod';
import { project, type MethodId, type ProjectedYear, type YearAssumptions } from './valuationEngine';

export const statuses = ['Pending', 'Met', 'Beat', 'Miss', 'Revised', 'Withdrawn'] as const;
export const methods = ['pe', 'pb', 'ev_ebitda', 'mcap_sales'] as const;
const number = z.number().finite();
export const quarterSchema = z.object({ id: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), label: z.string().min(1).max(40) });
export type Quarter = z.infer<typeof quarterSchema>;
export const sourceSchema = z.object({
	id: z.string().min(1).max(150), title: z.string().min(1).max(300),
	url: z.url().refine((s) => new URL(s).protocol === 'https:', 'Sources must use HTTPS'),
	page: z.number().int().positive().nullable(), excerpt: z.string().min(1).max(2000)
});
export type Source = z.infer<typeof sourceSchema>;
export const guidanceSchema = z.object({
	id: z.string().min(1).max(150), threadId: z.string().min(1).max(150),
	quarter: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), metric: z.string().min(1).max(100),
	commitment: z.string().min(1).max(2000), targetPeriod: z.string().min(1).max(100),
	status: z.enum(statuses), actual: z.string().max(2000), explanation: z.string().min(1).max(3000),
	sources: z.array(sourceSchema).min(1).max(12), origin: z.enum(['AI', 'Manual']),
	manual: z.boolean(), previousId: z.string().nullable(), recordedAt: number
});
export type Guidance = z.infer<typeof guidanceSchema>;
const yearSchema = z.object({
	revenueGrowthPct: number.min(-100), expensePct: number.min(0), otherIncome: number,
	interest: number.min(0), depreciation: number.min(0), taxPct: number.min(0).max(100),
	dividendPayoutPct: number.min(0).max(100), netDebt: number, targetMultiple: number.positive(),
	shares: number.positive(), minorityPAT: number.min(0), equityRaised: number.min(0),
	reasoning: z.string().min(1).max(4000), sources: z.array(sourceSchema).min(1).max(12)
});
const historicalSchema = z.object({
	label: z.string().min(1).max(30), endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
	sales: number.positive(), expenses: number, otherIncome: number, interest: number,
	depreciation: number, pbt: number, tax: number, netProfit: number, ownersPAT: number,
	eps: number, sources: z.array(sourceSchema).min(1).max(12)
});
export const modelSchema = z.object({
	method: z.enum(methods), recommendedMethod: z.enum(methods), diagnosis: z.string().min(1).max(5000),
	cmp: number.positive(), priceDate: z.string().min(1).max(40), shares: number.positive(), bookValuePerShare: number,
	history: z.array(historicalSchema).length(2),
	scenarios: z.object({ bear: z.array(yearSchema).length(3), base: z.array(yearSchema).length(3), bull: z.array(yearSchema).length(3) }),
	caveats: z.array(z.string().min(1).max(2000)).min(1).max(20), manual: z.boolean()
});
export type TrackerModel = z.infer<typeof modelSchema>;
export const analysisSchema = z.object({
	guidance: z.array(guidanceSchema).max(150), valuation: modelSchema.nullable(),
	warnings: z.array(z.string().max(2000)).max(30), summary: z.string().min(1).max(5000)
});
export type Analysis = z.infer<typeof analysisSchema>;
export interface TrackerCompany {
	symbol: string; name: string; bseCode: string | null; sector: string; subsector: string;
	version: number; quarters: Quarter[]; guidance: Guidance[]; valuation: TrackerModel | null;
	valuationHistory: TrackerModel[]; updatedBy: string; updatedAt: number;
}
export interface ResearchSource { id: string; title: string; url: string; pages: { page: number | null; text: string }[] }
export interface Research { quarters: Quarter[]; sources: ResearchSource[]; warnings: string[]; fetchedAt: number; bseCode?: string }
export interface Preview { id: string; symbol: string; userId: number; baseVersion: number; quarters: string[]; analysis: Analysis; createdAt: number; valuationRequested?: boolean; requestedMethod?: string; watchlistBaseVersion?: number }

export const createCompanySchema = z.object({
	symbol: z.string().trim().toUpperCase().regex(/^[A-Z0-9&._-]{1,40}$/),
	name: z.string().trim().min(1).max(200), bseCode: z.string().regex(/^\d{6}$/).nullable(),
	sector: z.string().trim().max(100), subsector: z.string().trim().max(100)
});
export const analyseSchema = z.object({
	quarters: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).min(1).max(12),
	valuation: z.boolean(), method: z.enum(['auto', ...methods]), refresh: z.boolean().default(false)
});

/** Verify citations against the actual supplied research, never trust an AI URL or page. */
export function validateAnalysis(analysis: Analysis, research: Research, company: TrackerCompany, selected: string[], requestedMethod: string) {
	const normalize = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();
	function cite(source: Source) {
		const doc = research.sources.find((d) => d.id === source.id && d.url === source.url);
		const page = doc?.pages.find((p) => p.page === source.page && normalize(p.text).includes(normalize(source.excerpt)));
		if (!page) throw new Error('The analysis contains an unverified source. Regenerate it before saving.');
	}
	const seen = new Set<string>();
	const known = new Map(company.guidance.map((g) => [g.id, g]));
	for (const g of analysis.guidance) {
		if (!selected.includes(g.quarter) || seen.has(g.id) || company.guidance.some((old) => old.id === g.id)) throw new Error('The analysis contains an invalid quarter or duplicate guidance.');
		seen.add(g.id);
		if (g.previousId) {
			const previous = known.get(g.previousId);
			if (!previous || previous.threadId !== g.threadId || previous.quarter > g.quarter) throw new Error('The guidance history link is invalid.');
		} else if ([...known.values()].some((old) => old.threadId === g.threadId)) throw new Error('Existing guidance must be linked to its earlier commitment.');
		if (['Met', 'Beat', 'Miss'].includes(g.status) && !g.actual.trim()) throw new Error('Execution status requires a reported actual.');
		g.sources.forEach(cite);
		known.set(g.id, g);
	}
	if (analysis.valuation) {
		const m = analysis.valuation;
		if (requestedMethod !== 'auto' && m.method !== requestedMethod) throw new Error('The model must respect the requested valuation method.');
		if (m.history[0].endDate >= m.history[1].endDate) throw new Error('Historical years must be in chronological order.');
		m.history.forEach((y) => y.sources.forEach(cite));
		Object.values(m.scenarios).forEach((years) => years.forEach((y) => y.sources.forEach(cite)));
	}
}

/** Append accepted updates; preserve the original promise and manual work as history. */
export function acceptPreview(company: TrackerCompany, preview: Preview, accepted: string[], valuation: boolean, actor: string, edited: Guidance[] = [], editedModel?: TrackerModel) {
	if (preview.baseVersion !== company.version) throw new Error('This company changed. Reload and regenerate the preview before saving.');
	const ids = new Set(accepted);
	if (ids.size !== accepted.length || accepted.some((id) => !preview.analysis.guidance.some((g) => g.id === id))) throw new Error('Choose valid preview items.');
	const overrides = new Map(edited.map((g) => [g.id, g]));
	if (edited.some((g) => !ids.has(g.id))) throw new Error('An edited item must be selected.');
	// If an earlier draft item is rejected, link its accepted successor to the nearest saved
	// predecessor instead; no saved history link may point at an item that was never accepted.
	function savedPredecessor(id: string | null): string | null {
		while (id && !ids.has(id) && !company.guidance.some((g) => g.id === id)) id = preview.analysis.guidance.find((g) => g.id === id)?.previousId ?? null;
		return id;
	}
	const additions = preview.analysis.guidance.filter((g) => ids.has(g.id)).map((g) => {
		const edit = overrides.get(g.id);
		if (edit && (edit.threadId !== g.threadId || edit.previousId !== g.previousId || edit.quarter !== g.quarter || JSON.stringify(edit.sources) !== JSON.stringify(g.sources))) throw new Error('Edits cannot change source or history links.');
		if (['Met', 'Beat', 'Miss'].includes((edit ?? g).status) && !(edit ?? g).actual.trim()) throw new Error('Execution status requires a reported actual.');
		return { ...(edit ?? g), previousId: savedPredecessor(g.previousId), origin: edit ? 'Manual' as const : 'AI' as const, manual: !!edit, recordedAt: Date.now() };
	});
	if (valuation && !preview.analysis.valuation) throw new Error('This preview has no valuation to accept.');
	if (!additions.length && !valuation) throw new Error('Select guidance or a valuation to save.');
	const model = valuation ? (editedModel ?? preview.analysis.valuation) : company.valuation;
	const history = valuation && company.valuation ? [...company.valuationHistory, company.valuation] : [...company.valuationHistory];
	if (valuation && editedModel && preview.analysis.valuation && JSON.stringify(editedModel) !== JSON.stringify(preview.analysis.valuation) && JSON.stringify(preview.analysis.valuation) !== JSON.stringify(company.valuation)) history.push(preview.analysis.valuation);
	return { ...company, guidance: [...company.guidance, ...additions], valuation: model,
		valuationHistory: history,
		version: company.version + 1, updatedBy: actor, updatedAt: Date.now() };
}

export function latestGuidance(company: TrackerCompany) {
	const latest = new Map<string, Guidance>();
	for (const g of company.guidance) { const old = latest.get(g.threadId); if (!old || g.quarter >= old.quarter) latest.set(g.threadId, g); }
	return [...latest.values()];
}

/** Reuse the existing engine one year at a time so disclosed dilution and minority PAT are explicit. */
export function scenarioYears(model: TrackerModel, scenario: 'bear' | 'base' | 'bull', preDilution = false): ProjectedYear[] {
	let sales = model.history[1].sales;
	let equity = model.bookValuePerShare * model.shares;
	return model.scenarios[scenario].map((a) => {
		const shares = preDilution ? model.shares : a.shares;
		if (!preDilution) equity += a.equityRaised;
		const inputs: YearAssumptions = a;
		const y = project(model.method as MethodId, sales, equity / shares, shares, { years: [inputs, inputs, inputs] })[0];
		const owners = y.netProfit - a.minorityPAT;
		y.eps = owners / shares;
		equity += owners * (1 - a.dividendPayoutPct / 100);
		y.bookValuePerShare = equity / shares;
		if (model.method === 'pe') y.impliedPrice = y.eps * a.targetMultiple;
		if (model.method === 'pb') y.impliedPrice = y.bookValuePerShare * a.targetMultiple;
		sales = y.sales;
		return y;
	});
}

export function annualizedReturn(price: number, cmp: number, targetDate: string, fromDate: string): number | null {
	const years = (Date.parse(targetDate) - Date.parse(fromDate)) / (365.25 * 86400000);
	return price > 0 && cmp > 0 && years > 0 ? (Math.pow(price / cmp, 1 / years) - 1) * 100 : null;
}
export function projectedLabels(model: TrackerModel) {
	const date = new Date(model.history[1].endDate + 'T00:00:00Z');
	return [1, 2, 3].map((i) => { const d = new Date(date); d.setUTCFullYear(date.getUTCFullYear() + i); return { label: `FY${String(d.getUTCFullYear()).slice(-2)}E`, endDate: d.toISOString().slice(0, 10) }; });
}
