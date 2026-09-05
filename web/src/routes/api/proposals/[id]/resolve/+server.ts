// Ports POST /api/proposals/{id}/resolve from app/routers/health.py.
import { json } from '@sveltejs/kit';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { requireWriteActor, errorResponse, handleAuthError, zodErrorMessage } from '$lib/server/http';
import { AlreadyResolvedError, NotFoundError, OverrideRequiresNoteError, resolveProposal } from '$lib/server/services/audit';

const resolveIn = z.object({
	action: z.enum(['accept', 'reject']),
	verdict: z.enum(['on_track', 'watch_closely', 'broken']).nullish(),
	note: z.string().nullish()
});

export const POST: RequestHandler = async ({ locals, params, request }) => {
	try {
		const actor = requireWriteActor(locals.actor);
		const body = await request.json();
		const parsed = resolveIn.safeParse(body);
		if (!parsed.success) return errorResponse(422, zodErrorMessage(parsed.error));

		const proposal = await resolveProposal(
			Number(params.id),
			parsed.data.action,
			parsed.data.verdict ?? null,
			parsed.data.note ?? null,
			actor.identity
		);
		return json({
			id: proposal.id,
			company_id: proposal.companyId,
			period: proposal.period,
			proposed_status: proposal.proposedStatus,
			source: proposal.source,
			rationale: proposal.rationale,
			evidence: proposal.evidence,
			state: proposal.state,
			model_name: proposal.modelName,
			created_at: proposal.createdAt
		});
	} catch (err) {
		if (err instanceof NotFoundError) return errorResponse(404, err.message);
		if (err instanceof AlreadyResolvedError) return errorResponse(409, err.message);
		if (err instanceof OverrideRequiresNoteError) return errorResponse(422, err.message);
		return handleAuthError(err);
	}
};
