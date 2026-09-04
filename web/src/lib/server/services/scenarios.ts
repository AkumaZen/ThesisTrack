// Ports app/services/scenarios.py
import { and, asc, eq } from 'drizzle-orm';
import { db } from '../db';
import { companies, thesisScenarios } from '../db/schema';

export class NotFoundError extends Error {}
export class ScenarioNotFoundError extends Error {}

export async function getCompanyOr404(companyId: string) {
	const [company] = await db.select().from(companies).where(eq(companies.companyId, companyId)).limit(1);
	if (!company) throw new NotFoundError(`company '${companyId}' not found`);
	return company;
}

export async function getMyScenario(companyId: string, owner: string) {
	await getCompanyOr404(companyId);
	const [scenario] = await db
		.select()
		.from(thesisScenarios)
		.where(and(eq(thesisScenarios.companyId, companyId), eq(thesisScenarios.owner, owner)))
		.limit(1);
	if (!scenario) {
		throw new ScenarioNotFoundError(`'${owner}' has no thesis on company '${companyId}' yet - start one first`);
	}
	return scenario;
}

export async function getScenarioOptional(companyId: string, owner: string) {
	const [scenario] = await db
		.select()
		.from(thesisScenarios)
		.where(and(eq(thesisScenarios.companyId, companyId), eq(thesisScenarios.owner, owner)))
		.limit(1);
	return scenario ?? null;
}

export async function listScenarios(companyId: string) {
	return db
		.select()
		.from(thesisScenarios)
		.where(eq(thesisScenarios.companyId, companyId))
		.orderBy(asc(thesisScenarios.createdAt));
}
