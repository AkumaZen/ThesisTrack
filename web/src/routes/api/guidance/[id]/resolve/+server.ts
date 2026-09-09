// Ports POST /api/guidance/{id}/resolve from app/routers/guidance.py. An
// optional { outcome } body marks the note achieved/missed in the same call
// (see setGuidanceOutcome) rather than needing a separate endpoint.
import { json } from '@sveltejs/kit';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { requireWriteActor, errorResponse, handleAuthError, zodErrorMessage } from '$lib/server/http';
import { resolveGuidance, setGuidanceOutcome } from '$lib/server/services/guidance';

const resolveIn = z.object({ outcome: z.enum(['achieved', 'missed']).nullish() });

function toOut(note: {
	id: number;
	companyId: string;
	blockKey: string;
	note: string;
	status: string;
	createdBy: string;
	createdAt: Date;
	resolvedBy: string | null;
	resolvedAt: Date | null;
	targetMetric: string | null;
	targetMetricLabel: string | null;
	targetValue: string | null;
	targetUnit: string | null;
	targetPeriod: string | null;
	expectedResultsDate: string | null;
	outcome: string;
}, companyName: string | null) {
	return {
		id: note.id,
		company_id: note.companyId,
		company_name: companyName,
		block_key: note.blockKey,
		note: note.note,
		status: note.status,
		created_by: note.createdBy,
		created_at: note.createdAt,
		resolved_by: note.resolvedBy,
		resolved_at: note.resolvedAt,
		target_metric: note.targetMetric,
		target_metric_label: note.targetMetricLabel,
		target_value: note.targetValue != null ? Number(note.targetValue) : null,
		target_unit: note.targetUnit,
		target_period: note.targetPeriod,
		expected_results_date: note.expectedResultsDate,
		outcome: note.outcome
	};
}

export const POST: RequestHandler = async ({ locals, params, request }) => {
	try {
		const actor = requireWriteActor(locals.actor);
		const id = Number(params.id);
		const body = request.headers.get('content-length') === '0' ? {} : await request.json().catch(() => ({}));
		const parsed = resolveIn.safeParse(body);
		if (!parsed.success) return errorResponse(422, zodErrorMessage(parsed.error));

		const result = parsed.data.outcome
			? await setGuidanceOutcome(id, parsed.data.outcome, actor.identity)
			: await resolveGuidance(id, actor.identity);
		if (!result) return errorResponse(404, `guidance note ${id} not found`);
		return json(toOut(result.note, result.companyName));
	} catch (err) {
		return handleAuthError(err);
	}
};
