// Ports app/services/decisions.py - append-only buy/sell decisions.
import { asc, eq } from 'drizzle-orm';
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

export async function listDecisions(companyId: string) {
	return db
		.select()
		.from(positionDecisions)
		.where(eq(positionDecisions.companyId, companyId))
		.orderBy(asc(positionDecisions.decidedOn), asc(positionDecisions.createdAt));
}
