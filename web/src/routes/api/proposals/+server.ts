// Ports GET /api/proposals from app/routers/health.py.
import { json } from '@sveltejs/kit';
import { and, desc, eq } from 'drizzle-orm';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { statusProposals, thesisScenarios } from '$lib/server/db/schema';
import { requireActor, handleAuthError } from '$lib/server/http';

export const GET: RequestHandler = async ({ locals, url }) => {
	try {
		const actor = requireActor(locals.actor);
		const state = (url.searchParams.has('state') ? url.searchParams.get('state') : 'pending') as
			| 'pending'
			| 'accepted'
			| 'rejected'
			| 'superseded'
			| null;
		const companyId = url.searchParams.get('company_id');

		const conditions = [eq(thesisScenarios.owner, actor.identity)];
		if (state) conditions.push(eq(statusProposals.state, state));
		if (companyId) conditions.push(eq(statusProposals.companyId, companyId));

		const rows = await db
			.select({ proposal: statusProposals })
			.from(statusProposals)
			.innerJoin(thesisScenarios, eq(statusProposals.scenarioId, thesisScenarios.id))
			.where(and(...conditions))
			.orderBy(desc(statusProposals.createdAt));

		return json(
			rows.map(({ proposal: p }) => ({
				id: p.id,
				company_id: p.companyId,
				period: p.period,
				proposed_status: p.proposedStatus,
				source: p.source,
				rationale: p.rationale,
				evidence: p.evidence,
				state: p.state,
				model_name: p.modelName,
				created_at: p.createdAt
			}))
		);
	} catch (err) {
		return handleAuthError(err);
	}
};
