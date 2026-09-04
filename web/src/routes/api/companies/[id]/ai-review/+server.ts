// Ports POST /api/companies/{id}/ai-review from app/routers/ai_review.py.
import { json } from '@sveltejs/kit';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { requireWriteActor, errorResponse, handleAuthError } from '$lib/server/http';
import { getLlmClient } from '$lib/server/llm/client';
import { AIReviewFailedError, NotFoundError, runAiReview } from '$lib/server/services/aiReviewer';

const aiReviewIn = z.object({
	period: z.string(),
	narrative: z.string().nullable().optional()
});

function toOut(p: {
	id: number;
	companyId: string;
	period: string | null;
	proposedStatus: string;
	source: string;
	rationale: string;
	evidence: unknown;
	state: string;
	modelName: string | null;
	createdAt: Date;
}) {
	return {
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
	};
}

export const POST: RequestHandler = async ({ locals, params, request }) => {
	try {
		const actor = requireWriteActor(locals.actor);
		const body = await request.json();
		const parsed = aiReviewIn.safeParse(body);
		if (!parsed.success) return errorResponse(422, parsed.error.message);

		const llmClient = getLlmClient();
		const proposal = await runAiReview(params.id!, parsed.data.period, parsed.data.narrative, llmClient, actor.identity);
		return json(toOut(proposal));
	} catch (err) {
		if (err instanceof NotFoundError) return errorResponse(404, err.message);
		if (err instanceof AIReviewFailedError) return errorResponse(502, err.message);
		return handleAuthError(err);
	}
};
