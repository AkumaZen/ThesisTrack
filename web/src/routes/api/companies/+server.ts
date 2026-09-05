// Ports GET/POST /api/companies from app/routers/companies.py.
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { and, count, eq, ilike, inArray, lt } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { broadIndustries, companies, specificNiches, thesisScenarios } from '$lib/server/db/schema';
import { errorResponse, requireActor, requireWriteActor, handleAuthError, zodErrorMessage } from '$lib/server/http';
import { thesisCreate } from '$lib/server/schemas/thesis';
import { createCompany, AlreadyExistsError, TaxonomyError } from '$lib/server/services/versioning';
import { listScenarios } from '$lib/server/services/scenarios';
import { coreMetricsForScenarios, latestOverrideFlags, scenarioToOut } from '$lib/server/services/companiesShared';

export const GET: RequestHandler = async ({ locals, url }) => {
	try {
		const actor = requireActor(locals.actor);
		const params = url.searchParams;
		const page = Number(params.get('page') ?? '1');
		const pageSize = Math.min(Number(params.get('page_size') ?? '25'), 200);
		const q = params.get('q');
		const status = params.getAll('status');
		const broadIndustryNames = params.getAll('broad_industry');
		const nicheNames = params.getAll('niche');
		const operatingModels = params.getAll('operating_model');

		const conditions = [];
		if (q) conditions.push(ilike(companies.name, `%${q}%`));
		if (broadIndustryNames.length) conditions.push(inArray(broadIndustries.name, broadIndustryNames));
		if (nicheNames.length) conditions.push(inArray(specificNiches.name, nicheNames));
		if (operatingModels.length) conditions.push(inArray(companies.operatingModel, operatingModels as never));
		if (status.length) conditions.push(inArray(thesisScenarios.status, status as never));
		if (params.get('review_due')) {
			const cutoff = new Date();
			cutoff.setDate(cutoff.getDate() - 91);
			conditions.push(lt(thesisScenarios.lastReviewed, cutoff.toISOString().slice(0, 10)));
		}

		const baseQuery = db
			.select({
				company: companies,
				industryName: broadIndustries.name,
				nicheName: specificNiches.name,
				scenario: thesisScenarios
			})
			.from(companies)
			.innerJoin(broadIndustries, eq(companies.broadIndustryId, broadIndustries.id))
			.innerJoin(specificNiches, eq(companies.specificNicheId, specificNiches.id))
			.leftJoin(
				thesisScenarios,
				and(eq(thesisScenarios.companyId, companies.companyId), eq(thesisScenarios.owner, actor.identity))
			);

		const filtered = conditions.length ? baseQuery.where(and(...conditions)) : baseQuery;
		const rows = await filtered.limit(pageSize).offset((page - 1) * pageSize);

		const [{ value: total }] = await db
			.select({ value: count() })
			.from(companies)
			.innerJoin(broadIndustries, eq(companies.broadIndustryId, broadIndustries.id))
			.innerJoin(specificNiches, eq(companies.specificNicheId, specificNiches.id))
			.leftJoin(
				thesisScenarios,
				and(eq(thesisScenarios.companyId, companies.companyId), eq(thesisScenarios.owner, actor.identity))
			)
			.where(conditions.length ? and(...conditions) : undefined);

		const companyIds = rows.map((r) => r.company.companyId);
		const scenarioCounts: Record<string, number> = {};
		if (companyIds.length) {
			const scenarioRows = await db
				.select({ companyId: thesisScenarios.companyId, value: count() })
				.from(thesisScenarios)
				.where(inArray(thesisScenarios.companyId, companyIds))
				.groupBy(thesisScenarios.companyId);
			for (const r of scenarioRows) scenarioCounts[r.companyId] = r.value;
		}

		const myScenarios = rows.map((r) => r.scenario).filter((s): s is NonNullable<typeof s> => s != null);
		const overrideFlags = await latestOverrideFlags(myScenarios.map((s) => s.id));
		const coreMetrics = await coreMetricsForScenarios(myScenarios);

		const items = rows.map((r) =>
			scenarioToOut(
				r.company,
				r.industryName,
				r.nicheName,
				r.scenario,
				scenarioCounts[r.company.companyId] ?? 0,
				r.scenario ? (overrideFlags[r.scenario.id] ?? false) : false,
				r.scenario ? (coreMetrics[r.scenario.id] ?? null) : null
			)
		);

		return json({ items, total, page, page_size: pageSize });
	} catch (err) {
		return handleAuthError(err);
	}
};

export const POST: RequestHandler = async ({ locals, request }) => {
	try {
		const actor = requireWriteActor(locals.actor);
		const parsed = thesisCreate.safeParse(await request.json());
		if (!parsed.success) return errorResponse(422, zodErrorMessage(parsed.error));

		const scenario = await createCompany(parsed.data, actor.identity);
		const [company] = await db.select().from(companies).where(eq(companies.companyId, scenario.companyId)).limit(1);
		const [industry] = await db.select().from(broadIndustries).where(eq(broadIndustries.id, company.broadIndustryId)).limit(1);
		const [niche] = await db.select().from(specificNiches).where(eq(specificNiches.id, company.specificNicheId)).limit(1);
		const scenarioCount = (await listScenarios(company.companyId)).length;

		return json(scenarioToOut(company, industry.name, niche.name, scenario, scenarioCount), { status: 201 });
	} catch (err) {
		if (err instanceof AlreadyExistsError) return errorResponse(409, err.message);
		if (err instanceof TaxonomyError) return errorResponse(422, err.message);
		return handleAuthError(err);
	}
};
