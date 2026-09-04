// Ports POST /api/companies/{id}/outcome from app/routers/health.py.
import { json } from '@sveltejs/kit';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { broadIndustries, companies, specificNiches } from '$lib/server/db/schema';
import { requireWriteActor, errorResponse, handleAuthError } from '$lib/server/http';
import { closeOutcome } from '$lib/server/services/audit';
import { NotFoundError, ScenarioNotFoundError, listScenarios } from '$lib/server/services/scenarios';
import { scenarioToOut } from '$lib/server/services/companiesShared';

const outcomeIn = z.object({
	outcome: z.enum(['played_out', 'invalidated', 'exited_early']),
	note: z.string().min(1)
});

export const POST: RequestHandler = async ({ locals, params, request }) => {
	try {
		const actor = requireWriteActor(locals.actor);
		const body = await request.json();
		const parsed = outcomeIn.safeParse(body);
		if (!parsed.success) return errorResponse(422, parsed.error.message);

		const scenario = await closeOutcome(params.id!, parsed.data.outcome, parsed.data.note, actor.identity);

		const [company] = await db.select().from(companies).where(eq(companies.companyId, params.id!)).limit(1);
		const [industry] = await db.select().from(broadIndustries).where(eq(broadIndustries.id, company.broadIndustryId)).limit(1);
		const [niche] = await db.select().from(specificNiches).where(eq(specificNiches.id, company.specificNicheId)).limit(1);
		const scenarios = await listScenarios(params.id!);

		return json(scenarioToOut(company, industry.name, niche.name, scenario, scenarios.length));
	} catch (err) {
		if (err instanceof NotFoundError || err instanceof ScenarioNotFoundError) return errorResponse(404, err.message);
		return handleAuthError(err);
	}
};
