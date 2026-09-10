// Review Queue: explicit Trackables from the actor's current thesis versions.
import { json } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { companies, thesisScenarios } from '$lib/server/db/schema';
import { requireActor, handleAuthError } from '$lib/server/http';
import { trackablesForScenarios } from '$lib/server/services/companiesShared';

export const GET: RequestHandler = async ({ locals }) => {
	try {
		const actor = requireActor(locals.actor);

		const rows = await db
			.select({ scenario: thesisScenarios, companyName: companies.name })
			.from(thesisScenarios)
			.innerJoin(companies, eq(thesisScenarios.companyId, companies.companyId))
			.where(eq(thesisScenarios.owner, actor.identity));

		const trackables = await trackablesForScenarios(rows.map((r) => r.scenario));

		const items = rows.flatMap((r) =>
			(trackables[r.scenario.id] ?? []).map((t) => ({
				...t,
				company_id: r.scenario.companyId,
				company_name: r.companyName
			}))
		);

		return json(items);
	} catch (err) {
		return handleAuthError(err);
	}
};
