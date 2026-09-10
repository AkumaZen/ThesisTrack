// Ports app/services/decisions.py - append-only buy/sell decisions.
import { and, asc, eq } from 'drizzle-orm';
import { db } from '../db';
import { positionDecisions } from '../db/schema';
import { getMyScenario } from './scenarios';

export async function logDecision(
	companyId: string,
	action: string,
	price: number,
	quantity: number | null,
	decidedOn: string,
	rationale: string,
	actor: string
) {
	const scenario = await getMyScenario(companyId, actor);

	const [decision] = await db
		.insert(positionDecisions)
		.values({
			companyId,
			scenarioId: scenario.id,
			versionId: scenario.currentVersionId,
			action,
			price: String(price),
			quantity: quantity != null ? String(quantity) : null,
			decidedOn,
			rationale,
			actor
		})
		.returning();
	return decision;
}

export async function listDecisions(companyId: string, owner?: string) {
	const scenario = owner ? await getMyScenario(companyId, owner) : null;
	return db
		.select()
		.from(positionDecisions)
		.where(and(eq(positionDecisions.companyId, companyId), scenario ? eq(positionDecisions.scenarioId, scenario.id) : undefined))
		.orderBy(asc(positionDecisions.decidedOn), asc(positionDecisions.createdAt));
}
