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
import {
	coreMetricsForScenarios,
	latestOverrideFlags,
	openGuidanceForScenarios,
	scenarioToOut,
	trackablesForScenarios
} from '$lib/server/services/companiesShared';

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
		// Every scenario for every company on this page - not just the
		// actor's own - so each card can carry a small "scenarios" list and
		// let the dashboard tile itself cycle through analysts without a
		// page navigation. Powers the top-level per-actor fields too
		// (scenarioCounts) so this replaces the old count-only query.
		const allScenariosOnPage = companyIds.length
			? await db.select().from(thesisScenarios).where(inArray(thesisScenarios.companyId, companyIds))
			: [];
		const scenarioCounts: Record<string, number> = {};
		const scenariosByCompany: Record<string, (typeof allScenariosOnPage)[number][]> = {};
		for (const s of allScenariosOnPage) {
			scenarioCounts[s.companyId] = (scenarioCounts[s.companyId] ?? 0) + 1;
			(scenariosByCompany[s.companyId] ??= []).push(s);
		}

		const overrideFlags = await latestOverrideFlags(allScenariosOnPage.map((s) => s.id));
		const coreMetrics = await coreMetricsForScenarios(allScenariosOnPage);
		const trackables = await trackablesForScenarios(allScenariosOnPage);
		const guidance = await openGuidanceForScenarios(companyIds, allScenariosOnPage);

		const items = rows.map((r) => {
			// My own scenario first (so the card defaults to "your" view same
			// as today), then every other analyst's, in creation order -
			// mirrors the company-detail page's cycle order.
			const scenarios = (scenariosByCompany[r.company.companyId] ?? [])
				.slice()
				.sort((a, b) => (a.owner === actor.identity ? -1 : b.owner === actor.identity ? 1 : a.id - b.id))
				.map((s) => ({
					owner: s.owner,
					status: s.status,
					last_reviewed: s.lastReviewed,
					has_active_override: overrideFlags[s.id] ?? false,
					core_metrics: coreMetrics[s.id] ?? {},
					trackables: trackables[s.id] ?? [],
					guidance: guidance[s.id] ?? []
				}));

			return {
				...scenarioToOut(
					r.company,
					r.industryName,
					r.nicheName,
					r.scenario,
					scenarioCounts[r.company.companyId] ?? 0,
					r.scenario ? (overrideFlags[r.scenario.id] ?? false) : false,
					r.scenario ? (coreMetrics[r.scenario.id] ?? null) : null
				),
				scenarios
			};
		});

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
