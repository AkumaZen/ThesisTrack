// Ports GET /api/taxonomy from app/routers/taxonomy.py + app/services/taxonomy.py.
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { asc, count, eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { broadIndustries, companies, specificNiches } from '$lib/server/db/schema';
import { requireActor, handleAuthError } from '$lib/server/http';

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
