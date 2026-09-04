// Ports app/services/rule_engine.py - deterministic kill-trigger evaluation.
import { and, desc, eq } from 'drizzle-orm';
import { db } from '../db';
import {
	companies,
	killTriggers,
	observations,
	statusProposals,
	thesisScenarios,
	triggerEvaluations
} from '../db/schema';

export class NotFoundError extends Error {}

const OPERATORS: Record<string, (a: number, b: number) => boolean> = {
	'<': (a, b) => a < b,
	'<=': (a, b) => a <= b,
	'>': (a, b) => a > b,
	'>=': (a, b) => a >= b,
	'==': (a, b) => a === b,
	'!=': (a, b) => a !== b
};

async function consecutiveBreachStreak(
	trigger: typeof killTriggers.$inferSelect,
	companyId: string,
	currentBreached: boolean
): Promise<number> {
	if (!currentBreached) return 0;

	const prior = await db
		.select({ evaluation: triggerEvaluations, periodEnd: observations.periodEnd })
		.from(triggerEvaluations)
		.innerJoin(
			observations,
			and(
				eq(observations.companyId, companyId),
				eq(observations.period, triggerEvaluations.period),
				eq(observations.metricKey, trigger.metricKey!)
			)
		)
		.where(eq(triggerEvaluations.triggerId, trigger.id))
		.orderBy(desc(observations.periodEnd));

	let streak = 1;
	for (const row of prior) {
		if (row.evaluation.breached) streak += 1;
		else break;
	}
	return streak;
}

async function existingPendingTriggerIds(scenarioId: number, period: string): Promise<Set<number>> {
	const rows = await db
		.select()
		.from(statusProposals)
		.where(
			and(
				eq(statusProposals.scenarioId, scenarioId),
				eq(statusProposals.period, period),
				eq(statusProposals.source, 'rule_engine'),
				eq(statusProposals.state, 'pending')
			)
		);
	const ids = new Set<number>();
	for (const row of rows) {
		const evidence = (row.evidence as { trigger_id?: number } | null) ?? null;
		if (evidence?.trigger_id != null) ids.add(evidence.trigger_id);
	}
	return ids;
}

async function evaluateScenario(scenario: typeof thesisScenarios.$inferSelect, period: string) {
	if (scenario.currentVersionId == null) return [];

	const triggers = await db
		.select()
		.from(killTriggers)
		.where(and(eq(killTriggers.versionId, scenario.currentVersionId), eq(killTriggers.manualCheck, false)));
	if (!triggers.length) return [];

	const alreadyPending = await existingPendingTriggerIds(scenario.id, period);
	const newProposals: (typeof statusProposals.$inferSelect)[] = [];

	for (const trigger of triggers) {
		const [obs] = await db
			.select()
			.from(observations)
			.where(
				and(
					eq(observations.companyId, scenario.companyId),
					eq(observations.period, period),
					eq(observations.metricKey, trigger.metricKey!)
				)
			)
			.limit(1);
		if (!obs || obs.numericValue == null) continue; // data gap, not a breach

		const observed = Number(obs.numericValue);
		const threshold = Number(trigger.threshold);
		const breached = OPERATORS[trigger.operator!](observed, threshold);

		const streak = await consecutiveBreachStreak(trigger, scenario.companyId, breached);
		const fired = breached && streak >= trigger.gracePeriods;

		await db
			.insert(triggerEvaluations)
			.values({
				triggerId: trigger.id,
				period,
				observedValue: obs.numericValue,
				breached,
				fired
			})
			.onConflictDoUpdate({
				target: [triggerEvaluations.triggerId, triggerEvaluations.period],
				set: { observedValue: obs.numericValue, breached, fired }
			});

		if (fired && !alreadyPending.has(trigger.id)) {
			const proposedStatus = trigger.severity === 'kill' ? 'broken' : 'watch_closely';
			const [proposal] = await db
				.insert(statusProposals)
				.values({
					companyId: scenario.companyId,
					scenarioId: scenario.id,
					period,
					proposedStatus,
					source: 'rule_engine',
					rationale:
						`Kill trigger '${trigger.label}' fired: ${trigger.metricKey} observed=${observed} ` +
						`${trigger.operator} threshold=${threshold}, ${streak} consecutive period(s) ` +
						`(grace_periods=${trigger.gracePeriods}) ending ${period}.`,
					evidence: {
						trigger_id: trigger.id,
						metric_key: trigger.metricKey,
						observed_value: observed,
						operator: trigger.operator,
						threshold,
						consecutive_periods: streak,
						grace_periods: trigger.gracePeriods
					},
					state: 'pending'
				})
				.returning();
			newProposals.push(proposal);
		}
	}

	return newProposals;
}

export async function evaluateObservations(companyId: string, period: string) {
	const [company] = await db.select().from(companies).where(eq(companies.companyId, companyId)).limit(1);
	if (!company) throw new NotFoundError(`company '${companyId}' not found`);

	const scenarios = await db.select().from(thesisScenarios).where(eq(thesisScenarios.companyId, companyId));

	const allNewProposals: (typeof statusProposals.$inferSelect)[] = [];
	for (const scenario of scenarios) {
		allNewProposals.push(...(await evaluateScenario(scenario, period)));
	}
	return allNewProposals;
}
