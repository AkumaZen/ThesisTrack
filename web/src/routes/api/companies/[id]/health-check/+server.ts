// Ports POST/PUT /api/companies/{id}/health-check from app/routers/health.py.
import { json } from '@sveltejs/kit';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { requireWriteActor, errorResponse, handleAuthError, zodErrorMessage } from '$lib/server/http';
import { NotFoundError as ScenarioLookupNotFoundError, ScenarioNotFoundError } from '$lib/server/services/scenarios';
import { OverrideRequiresNoteError, submitHealthCheck } from '$lib/server/services/audit';

const PERIOD_PATTERN = /^FY\d{2}Q[1-4]$|^FY\d{2}$/;

const healthCheckIn = z.object({
	period: z.string().regex(PERIOD_PATTERN),
	verdict: z.enum(['on_track', 'watch_closely', 'broken']),
	note: z.string().min(1)
});

function toOut(h: {
	id: number;
	companyId: string;
	period: string;
	verdict: string;
	source: string;
	note: string;
	humanConfirmed: boolean;
	author: string | null;
	createdAt: Date;
}) {
	return {
		id: h.id,
		company_id: h.companyId,
		period: h.period,
		verdict: h.verdict,
		source: h.source,
		note: h.note,
		human_confirmed: h.humanConfirmed,
		author: h.author,
		created_at: h.createdAt
	};
}

const handle: RequestHandler = async ({ locals, params, request }) => {
	try {
		const actor = requireWriteActor(locals.actor);
		const body = await request.json();
		const parsed = healthCheckIn.safeParse(body);
		if (!parsed.success) return errorResponse(422, zodErrorMessage(parsed.error));

		const health = await submitHealthCheck(params.id!, parsed.data.period, parsed.data.verdict, parsed.data.note, actor.identity);
		return json(toOut(health), { status: 201 });
	} catch (err) {
		if (err instanceof ScenarioLookupNotFoundError || err instanceof ScenarioNotFoundError) return errorResponse(404, err.message);
		if (err instanceof OverrideRequiresNoteError) return errorResponse(422, err.message);
		return handleAuthError(err);
	}
};

export const POST = handle;
export const PUT = handle;
