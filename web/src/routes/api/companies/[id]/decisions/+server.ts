// Ports app/routers/decisions.py.
import { json } from '@sveltejs/kit';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { requireActor, requireWriteActor, errorResponse, handleAuthError } from '$lib/server/http';
import { listDecisions, logDecision } from '$lib/server/services/decisions';
import { NotFoundError, ScenarioNotFoundError } from '$lib/server/services/scenarios';

const decisionIn = z.object({
	action: z.enum(['buy', 'sell']),
	price: z.number().gt(0),
	quantity: z.number().gt(0).nullish(),
	decided_on: z.string(),
	rationale: z.string().min(1)
});

function toOut(d: {
	id: number;
	companyId: string;
	versionId: number | null;
	action: string;
	price: string;
	quantity: string | null;
	decidedOn: string;
	rationale: string;
	actor: string;
	createdAt: Date;
}) {
	return {
		id: d.id,
		company_id: d.companyId,
		version_id: d.versionId,
		action: d.action,
		price: Number(d.price),
		quantity: d.quantity != null ? Number(d.quantity) : null,
		decided_on: d.decidedOn,
		rationale: d.rationale,
		actor: d.actor,
		created_at: d.createdAt
	};
}

export const POST: RequestHandler = async ({ locals, params, request }) => {
	try {
		const actor = requireWriteActor(locals.actor);
		const body = await request.json();
		const parsed = decisionIn.safeParse(body);
		if (!parsed.success) return errorResponse(422, parsed.error.message);

		const decision = await logDecision(
			params.id!,
			parsed.data.action,
			parsed.data.price,
			parsed.data.quantity ?? null,
			parsed.data.decided_on,
			parsed.data.rationale,
			actor.identity
		);
		return json(toOut(decision), { status: 201 });
	} catch (err) {
		if (err instanceof NotFoundError || err instanceof ScenarioNotFoundError) return errorResponse(404, err.message);
		return handleAuthError(err);
	}
};

export const GET: RequestHandler = async ({ locals, params }) => {
	try {
		requireActor(locals.actor);
		const rows = await listDecisions(params.id!);
		return json(rows.map(toOut));
	} catch (err) {
		return handleAuthError(err);
	}
};
