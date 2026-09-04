// Ports app/services/ai_reviewer.py. Advisory only: writes a status_proposals
// row (source='ai_proposed') and NEVER touches thesis_scenarios.status -
// that would let an unreviewed model verdict become the ground truth this
// platform later fine-tunes on.
//
// A malformed/unparseable response, even after one retry, fails safe: no
// proposal row is written at all, rather than a garbage one.
import { and, desc, eq, inArray } from 'drizzle-orm';
import { db } from '../db';
import { broadIndustries, companies, killTriggers, observations, specificNiches, statusProposals, thesisVersions, triggerEvaluations } from '../db/schema';
import { getScenarioOptional } from './scenarios';
import { LLMResponseError, type LLMClient } from '../llm/client';
import { REVIEWER_SYSTEM_PROMPT, buildReviewerUserPrompt } from '../llm/prompts';

const ANALYST_NAME = 'analyst';

export const VALID_VERDICTS = new Set(['on_track', 'watch_closely', 'broken']);
const MAX_ATTEMPTS = 2;

export class NotFoundError extends Error {}

/** The model's response could not be used - fails safe, no proposal written. */
export class AIReviewFailedError extends Error {}

async function lastNPeriodsObservations(companyId: string, n = 4) {
	const distinctPeriods = await db
		.selectDistinct({ period: observations.period })
		.from(observations)
		.where(eq(observations.companyId, companyId))
		.orderBy(desc(observations.period))
		.limit(n);
	const periods = distinctPeriods.map((r) => r.period);
	if (!periods.length) return [];

	const rows = await db
		.select()
		.from(observations)
		.where(and(eq(observations.companyId, companyId), inArray(observations.period, periods)))
		.orderBy(desc(observations.periodEnd));
	return rows.map((r) => ({
			period: r.period,
			metric_key: r.metricKey,
			value: r.numericValue != null ? Number(r.numericValue) : r.textValue,
			source_url: r.sourceUrl
		}));
}

async function ruleEngineFindings(versionId: number, period: string) {
	const triggers = await db.select().from(killTriggers).where(eq(killTriggers.versionId, versionId));
	const findings: Array<{ trigger: string; threshold: number | null; observed: number | null; breached: boolean }> = [];
	for (const trigger of triggers) {
		const [found] = await db
			.select()
			.from(triggerEvaluations)
			.where(and(eq(triggerEvaluations.triggerId, trigger.id), eq(triggerEvaluations.period, period)))
			.limit(1);
		if (found) {
			findings.push({
				trigger: trigger.label,
				threshold: trigger.threshold != null ? Number(trigger.threshold) : null,
				observed: found.observedValue != null ? Number(found.observedValue) : null,
				breached: found.breached
			});
		}
	}
	return findings;
}

/** Calls the LLM up to MAX_ATTEMPTS times, appending a corrective "JSON only"
 * instruction to the prompt on retry after a parse failure. Exported for
 * unit testing the retry behavior against a mocked LLMClient. */
export async function completeWithRetry(llmClient: LLMClient, userPrompt: string): Promise<Record<string, unknown>> {
	let response: Record<string, unknown> | null = null;
	let lastError: unknown = null;
	for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
		let prompt = userPrompt;
		if (attempt > 0) {
			prompt +=
				'\n\nYour previous response was not valid JSON matching the required schema. ' +
				'Return JSON only, with exactly these keys: verdict, confidence, reasoning_chain, ' +
				'evidence_used, unresolved_questions.';
		}
		try {
			response = (await llmClient.completeJson(REVIEWER_SYSTEM_PROMPT, prompt)) as Record<string, unknown>;
			break;
		} catch (exc) {
			if (exc instanceof LLMResponseError) {
				lastError = exc;
				continue;
			}
			throw exc;
		}
	}

	if (response == null) {
		throw new AIReviewFailedError(`model response was not valid JSON after ${MAX_ATTEMPTS} attempts: ${lastError}`);
	}
	return response;
}

/** Same verdict/reasoning_chain validation app/services/ai_reviewer.py applies
 * to a parsed LLM response - exported for unit testing without a DB. */
export function validateReviewerResponse(response: Record<string, unknown>): {
	verdict: 'on_track' | 'watch_closely' | 'broken';
	reasoningChain: unknown[];
} {
	const verdict = response.verdict;
	const reasoningChain = response.reasoning_chain;
	if (typeof verdict !== 'string' || !VALID_VERDICTS.has(verdict)) {
		throw new AIReviewFailedError(`model returned an unrecognized verdict: ${JSON.stringify(verdict)}`);
	}
	if (!Array.isArray(reasoningChain) || reasoningChain.length < 1) {
		throw new AIReviewFailedError(`model response is missing a reasoning_chain: ${JSON.stringify(response)}`);
	}
	return { verdict: verdict as 'on_track' | 'watch_closely' | 'broken', reasoningChain };
}

export async function runAiReview(
	companyId: string,
	period: string,
	narrative: string | null | undefined,
	llmClient: LLMClient,
	actor: string = ANALYST_NAME
) {
	const [company] = await db.select().from(companies).where(eq(companies.companyId, companyId)).limit(1);
	if (!company) throw new NotFoundError(`company '${companyId}' not found`);

	const scenario = await getScenarioOptional(companyId, actor);
	if (scenario == null || scenario.currentVersionId == null) {
		throw new NotFoundError(`'${actor}' has no thesis on company '${companyId}' yet`);
	}

	const [version] = await db.select().from(thesisVersions).where(eq(thesisVersions.versionId, scenario.currentVersionId)).limit(1);
	const [industry] = await db.select().from(broadIndustries).where(eq(broadIndustries.id, company.broadIndustryId)).limit(1);
	const [niche] = await db.select().from(specificNiches).where(eq(specificNiches.id, company.specificNicheId)).limit(1);

	const metrics = await lastNPeriodsObservations(companyId);
	const findings = await ruleEngineFindings(version.versionId, period);
	const userPrompt = buildReviewerUserPrompt({
		companyName: company.name,
		broadIndustry: industry.name,
		specificNiche: niche.name,
		operatingModel: company.operatingModel,
		authoredAt: version.authoredAt.toISOString(),
		thesisData: version.thesisData as never,
		period,
		metrics,
		narrative,
		ruleEngineFindings: findings
	});

	const response = await completeWithRetry(llmClient, userPrompt);
	const { verdict, reasoningChain } = validateReviewerResponse(response);

	const [proposal] = await db
		.insert(statusProposals)
		.values({
			companyId,
			scenarioId: scenario.id,
			period,
			proposedStatus: verdict as 'on_track' | 'watch_closely' | 'broken',
			source: 'ai_proposed',
			rationale: reasoningChain.map((step) => String(step)).join(' '),
			evidence: {
				reasoning_chain: reasoningChain,
				evidence_used: response.evidence_used ?? [],
				confidence: response.confidence ?? null,
				unresolved_questions: response.unresolved_questions ?? []
			},
			state: 'pending',
			modelName: llmClient.modelName ?? 'unknown'
		})
		.returning();
	return proposal;
}
