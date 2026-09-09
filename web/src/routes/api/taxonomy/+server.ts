// Ports GET /api/taxonomy from app/routers/taxonomy.py + app/services/taxonomy.py.
// POST is a new addition (not in the original Python app): lets any writer
// propose a brand-new Broad Industry, mirroring POST /taxonomy/niches's
// existing "propose a niche" shape one level up the hierarchy.
import { json } from '@sveltejs/kit';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { asc, count, eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { broadIndustries, companies, specificNiches } from '$lib/server/db/schema';
import { requireActor, requireWriteActor, errorResponse, handleAuthError, zodErrorMessage } from '$lib/server/http';
import { proposeIndustry, TaxonomyError } from '$lib/server/services/taxonomy';

export const GET: RequestHandler = async ({ locals }) => {
	try {
		requireActor(locals.actor);
		const industries = await db.select().from(broadIndustries).orderBy(asc(broadIndustries.name));
		const nicheCounts = await db
			.select({ nicheId: companies.specificNicheId, value: count() })
			.from(companies)
			.groupBy(companies.specificNicheId);
		const nicheCountMap = new Map(nicheCounts.map((r) => [r.nicheId, r.value]));
		const industryCounts = await db
			.select({ industryId: companies.broadIndustryId, value: count() })
			.from(companies)
			.groupBy(companies.broadIndustryId);
		const industryCountMap = new Map(industryCounts.map((r) => [r.industryId, r.value]));

		const result = [];
		for (const industry of industries) {
			const niches = await db
				.select()
				.from(specificNiches)
				.where(eq(specificNiches.broadIndustryId, industry.id))
				.orderBy(asc(specificNiches.name));
			result.push({
				id: industry.id,
				name: industry.name,
				company_count: industryCountMap.get(industry.id) ?? 0,
				niches: niches.map((n) => ({
					id: n.id,
					name: n.name,
					is_active: n.isActive,
					company_count: nicheCountMap.get(n.id) ?? 0
				}))
			});
		}
		return json(result);
	} catch (err) {
		return handleAuthError(err);
	}
};

const industryIn = z.object({ name: z.string().trim().min(1) });

export const POST: RequestHandler = async ({ locals, request }) => {
	try {
		requireWriteActor(locals.actor);
		const parsed = industryIn.safeParse(await request.json());
		if (!parsed.success) return errorResponse(422, zodErrorMessage(parsed.error));

		const industry = await proposeIndustry(parsed.data.name);
		return json({ id: industry.id, name: industry.name, company_count: 0, niches: [] }, { status: 201 });
	} catch (err) {
		if (err instanceof TaxonomyError) return errorResponse(422, err.message);
		return handleAuthError(err);
	}
};
