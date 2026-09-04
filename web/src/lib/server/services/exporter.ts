// Ports app/services/exporter.py. Three task shapes from one internal
// representation, serialized to three formats, gated by eligibility filters,
// split company-disjoint by a deterministic hash of company_id.
//
// These filters are correctness requirements, not preferences - never relax
// them to raise row count.
import { and, eq, inArray, lt } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { db } from '../db';
import { companies, healthChecks, killTriggers, observations, thesisScenarios, thesisVersions, trainingSplits } from '../db/schema';
import { thesisData as thesisDataSchema } from '../schemas/thesis';
import { REVIEWER_PROMPT_VERSION, REVIEWER_SYSTEM_PROMPT } from '../llm/prompts';

export const VALID_TASKS = new Set(['thesis_synthesis', 'verdict', 'redline_extraction']);
export const VALID_FORMATS = new Set(['anthropic', 'openai', 'llama']);
export const VALID_SPLITS = new Set(['train', 'eval', 'all']);

const EVAL_HOLDOUT_BUCKET = 1500; // ~15% of 10000

const SYSTEM_PROMPTS: Record<string, string> = {
	thesis_synthesis:
		'You are an investment analyst. Given raw company data (classification and ' +
		'prior operating metrics), produce a structured 7-pillar investment thesis. ' +
		'Return JSON only.',
	verdict: REVIEWER_SYSTEM_PROMPT,
	redline_extraction:
		'You are an investment analyst. Given an investment thesis narrative, extract ' +
		'the structured invalidation triggers (kill switches) it implies. Return JSON only.'
};

function toFloat(value: unknown): number | null {
	return value != null ? Number(value) : null;
}

/** sha256(company_id) % 10000 < 1500 => eval, else train. Deterministic. */
export function hashSplit(companyId: string): 'train' | 'eval' {
	const digest = createHash('sha256').update(companyId, 'utf-8').digest('hex');
	const mod = BigInt('0x' + digest) % 10000n;
	return mod < BigInt(EVAL_HOLDOUT_BUCKET) ? 'eval' : 'train';
}

/** Assigns any company missing a training_splits row. Deterministic on first
 * assignment (hash of company_id); the row itself is then the source of
 * truth so a later manual override survives future exports. */
export async function ensureSplitAssignments(): Promise<void> {
	const companyRows = await db.select({ companyId: companies.companyId }).from(companies);
	const existingRows = await db.select({ companyId: trainingSplits.companyId }).from(trainingSplits);
	const existing = new Set(existingRows.map((r) => r.companyId));
	const missing = companyRows.map((r) => r.companyId).filter((id) => !existing.has(id));
	for (const companyId of missing) {
		await db.insert(trainingSplits).values({ companyId, split: hashSplit(companyId) });
	}
}

async function companyIdsForSplit(split: string): Promise<Set<string>> {
	await ensureSplitAssignments();
	const rows =
		split === 'all'
			? await db.select({ companyId: trainingSplits.companyId }).from(trainingSplits)
			: await db
					.select({ companyId: trainingSplits.companyId })
					.from(trainingSplits)
					.where(eq(trainingSplits.split, split));
	return new Set(rows.map((r) => r.companyId));
}

async function periodEndFor(companyId: string, period: string): Promise<string | null> {
	const [row] = await db
		.select({ periodEnd: observations.periodEnd })
		.from(observations)
		.where(and(eq(observations.companyId, companyId), eq(observations.period, period)))
		.limit(1);
	return row?.periodEnd ?? null;
}

export interface ExportRow {
	task: string;
	company_id: string;
	input: unknown;
	output: unknown;
	metadata: Record<string, unknown>;
}

async function thesisSynthesisRows(companyIds: Set<string>): Promise<ExportRow[]> {
	if (!companyIds.size) return [];
	const versions = await db.select().from(thesisVersions).where(inArray(thesisVersions.companyId, [...companyIds]));
	const rows: ExportRow[] = [];
	for (const version of versions) {
		const parsed = thesisDataSchema.safeParse(version.thesisData);
		if (!parsed.success) continue; // rule 3: must pass schema validation

		const [company] = await db.select().from(companies).where(eq(companies.companyId, version.companyId)).limit(1);
		// "Raw company data" input, honestly limited by the schema: classification
		// plus whatever was observed before this version was authored. No
		// filings/concall text store exists, so this is the real proxy available.
		const priorObservations = await db
			.select()
			.from(observations)
			.where(and(eq(observations.companyId, version.companyId), lt(observations.periodEnd, toDateOnly(version.authoredAt))));

		rows.push({
			task: 'thesis_synthesis',
			company_id: version.companyId,
			input: {
				company_name: company.name,
				operating_model: company.operatingModel,
				currency: company.currency,
				as_of: toDateOnly(version.authoredAt),
				prior_observations: priorObservations.map((o) => ({
					period: o.period,
					metric_key: o.metricKey,
					value: toFloat(o.numericValue) ?? o.textValue
				}))
			},
			output: version.thesisData,
			metadata: { version_no: version.versionNo, authored_at: version.authoredAt.toISOString() }
		});
	}
	return rows;
}

function toDateOnly(d: Date): string {
	return d.toISOString().slice(0, 10);
}

async function verdictRows(companyIds: Set<string>, includeOpen: boolean): Promise<ExportRow[]> {
	if (!companyIds.size) return [];
	const checks = await db.select().from(healthChecks).where(inArray(healthChecks.companyId, [...companyIds]));
	const rows: ExportRow[] = [];
	for (const hc of checks) {
		// rule 1: never train on unreviewed model output
		if (hc.source === 'ai_proposed' && !hc.humanConfirmed) continue;
		// rule 3: >= 3 reasoning steps
		const reasoningChain = hc.reasoningChain as unknown[] | null;
		if (!reasoningChain || reasoningChain.length < 3) continue;

		// rule 4: default to resolved-outcome scenarios only for this task -
		// "outcome" is per-user thesis state, not company-wide.
		const [scenario] = await db.select().from(thesisScenarios).where(eq(thesisScenarios.id, hc.scenarioId)).limit(1);
		if (!includeOpen && scenario.outcome === 'open') continue;

		const [version] = await db.select().from(thesisVersions).where(eq(thesisVersions.versionId, hc.versionId)).limit(1);
		const periodEnd = await periodEndFor(hc.companyId, hc.period);
		// rule 2, the leakage check: the version must predate the period it's
		// reasoning about. No period_end on record means we can't verify it -
		// exclude rather than assume it's safe.
		if (periodEnd == null || toDateOnly(version.authoredAt) >= periodEnd) continue;

		const triggers = await db.select().from(killTriggers).where(eq(killTriggers.versionId, hc.versionId));
		const ruleEngineFindings = triggers.map((t) => ({
			trigger: t.label,
			metric_key: t.metricKey,
			threshold: toFloat(t.threshold),
			severity: t.severity
		}));

		const evidence = (hc.evidence ?? {}) as { confidence?: number | null };
		rows.push({
			task: 'verdict',
			company_id: hc.companyId,
			input: {
				thesis_data: version.thesisData,
				period: hc.period,
				rule_engine_findings: ruleEngineFindings
			},
			output: {
				verdict: hc.verdict,
				reasoning_chain: reasoningChain,
				confidence: evidence.confidence ?? null
			},
			metadata: {
				period: hc.period,
				authored_at: version.authoredAt.toISOString(),
				period_end: periodEnd,
				health_check_id: hc.id,
				confidence: evidence.confidence ?? null
			}
		});
	}
	return rows;
}

interface ThesisDataShape {
	the_business?: { what_it_does?: string };
	the_growth_engine?: string[];
	the_big_change?: { summary?: string };
	why_we_believe_it?: string[];
}

async function redlineExtractionRows(companyIds: Set<string>): Promise<ExportRow[]> {
	if (!companyIds.size) return [];
	const versions = await db.select().from(thesisVersions).where(inArray(thesisVersions.companyId, [...companyIds]));
	const rows: ExportRow[] = [];
	for (const version of versions) {
		const triggers = await db.select().from(killTriggers).where(eq(killTriggers.versionId, version.versionId));
		if (!triggers.length) continue;
		const thesisData = (version.thesisData ?? {}) as ThesisDataShape;
		const narrative = [
			thesisData.the_business?.what_it_does ?? '',
			...(thesisData.the_growth_engine ?? []),
			thesisData.the_big_change?.summary ?? '',
			...(thesisData.why_we_believe_it ?? [])
		]
			.join(' ')
			.trim();
		if (!narrative) continue;

		rows.push({
			task: 'redline_extraction',
			company_id: version.companyId,
			input: { thesis_narrative: narrative },
			output: triggers.map((t) => ({
				label: t.label,
				metric_key: t.metricKey,
				operator: t.operator,
				threshold: toFloat(t.threshold),
				severity: t.severity,
				action: t.action,
				grace_periods: t.gracePeriods,
				manual_check: t.manualCheck
			})),
			metadata: { version_no: version.versionNo, authored_at: version.authoredAt.toISOString() }
		});
	}
	return rows;
}

async function rowsForTask(task: string, companyIds: Set<string>, includeOpen: boolean): Promise<ExportRow[]> {
	if (task === 'thesis_synthesis') return thesisSynthesisRows(companyIds);
	if (task === 'verdict') return verdictRows(companyIds, includeOpen);
	if (task === 'redline_extraction') return redlineExtractionRows(companyIds);
	throw new Error(`unknown task ${task}`);
}

export function serialize(row: ExportRow, fmt: string): Record<string, unknown> {
	const systemPrompt = SYSTEM_PROMPTS[row.task];
	const userContent = row.input;
	const metadata = {
		...row.metadata,
		task: row.task,
		company_id: row.company_id,
		prompt_version: REVIEWER_PROMPT_VERSION
	};

	if (fmt === 'anthropic') {
		return {
			system: systemPrompt,
			messages: [
				{ role: 'user', content: userContent },
				{ role: 'assistant', content: row.output }
			],
			metadata
		};
	}
	if (fmt === 'openai') {
		return {
			messages: [
				{ role: 'system', content: systemPrompt },
				{ role: 'user', content: userContent },
				{ role: 'assistant', content: row.output }
			],
			metadata
		};
	}
	if (fmt === 'llama') {
		return {
			prompt: `<s>[INST] <<SYS>>\n${systemPrompt}\n<</SYS>>\n\n${userContent} [/INST]`,
			completion: row.output,
			metadata
		};
	}
	throw new Error(`unknown format ${fmt}`);
}

export async function exportRows(
	task: string,
	fmt: string,
	split: string = 'all',
	includeOpen = false
): Promise<Record<string, unknown>[]> {
	if (!VALID_TASKS.has(task)) throw new Error(`task must be one of ${[...VALID_TASKS].sort().join(', ')}`);
	if (!VALID_FORMATS.has(fmt)) throw new Error(`format must be one of ${[...VALID_FORMATS].sort().join(', ')}`);
	if (!VALID_SPLITS.has(split)) throw new Error(`split must be one of ${[...VALID_SPLITS].sort().join(', ')}`);

	const companyIds = await companyIdsForSplit(split);
	const rows = await rowsForTask(task, companyIds, includeOpen);
	return rows.map((r) => serialize(r, fmt));
}

/** Pre-serialization 'verdict' task rows for the eval-split companies - the
 * input an eval harness would need, without reaching into this module's
 * internal row builders. */
export async function evalSplitVerdictRows(includeOpen = false): Promise<ExportRow[]> {
	const companyIds = await companyIdsForSplit('eval');
	return verdictRows(companyIds, includeOpen);
}

export interface ExportStats {
	row_count: number;
	row_count_by_task: Record<string, number>;
	class_balance: Record<string, Record<string, number>>;
	by_operating_model: Record<string, Record<string, number>>;
	leakage_violations: number;
	companies_by_split: Record<string, number>;
}

export async function exportStats(split: string = 'all', includeOpen = false): Promise<ExportStats> {
	await ensureSplitAssignments();
	const companyIds = await companyIdsForSplit(split);

	const rowCounts: Record<string, number> = {};
	const classBalance: Record<string, Record<string, number>> = {};
	const byOperatingModel: Record<string, Record<string, number>> = {};
	let leakageViolations = 0;

	const companyRows = await db.select().from(companies);
	const companiesById = new Map(companyRows.map((c) => [c.companyId, c]));

	for (const task of VALID_TASKS) {
		const rows = await rowsForTask(task, companyIds, includeOpen);
		rowCounts[task] = rows.length;

		if (task === 'verdict') {
			const balance: Record<string, number> = {};
			for (const r of rows) {
				const v = (r.output as { verdict: string }).verdict;
				balance[v] = (balance[v] ?? 0) + 1;
			}
			classBalance[task] = balance;
		}

		const modelCounts: Record<string, number> = {};
		for (const r of rows) {
			const company = companiesById.get(r.company_id);
			const key = company ? company.operatingModel : 'unknown';
			modelCounts[key] = (modelCounts[key] ?? 0) + 1;
		}
		byOperatingModel[task] = modelCounts;
	}

	// Leakage check across ALL verdict-eligible rows regardless of the
	// include_open filter, since this is a correctness audit, not a
	// dataset-shape query.
	const allCompanyIds = await companyIdsForSplit('all');
	for (const r of await verdictRows(allCompanyIds, true)) {
		const authoredAt = String(r.metadata.authored_at).slice(0, 10);
		const periodEnd = String(r.metadata.period_end);
		if (authoredAt >= periodEnd) leakageViolations++;
	}

	const splitCounts: Record<string, number> = {};
	for (const s of ['train', 'eval']) {
		splitCounts[s] = (await companyIdsForSplit(s)).size;
	}

	return {
		row_count: Object.values(rowCounts).reduce((a, b) => a + b, 0),
		row_count_by_task: rowCounts,
		class_balance: classBalance,
		by_operating_model: byOperatingModel,
		leakage_violations: leakageViolations,
		companies_by_split: splitCounts
	};
}
