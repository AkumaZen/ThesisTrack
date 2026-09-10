// Ports POST /api/companies/{id}/guidance from app/routers/guidance.py.
import { json } from '@sveltejs/kit';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { requireWriteActor, errorResponse, handleAuthError, zodErrorMessage } from '$lib/server/http';
import { createGuidance } from '$lib/server/services/guidance';
import { NotFoundError } from '$lib/server/services/scenarios';

const BLOCK_KEYS = [
	'the_business',
	'the_growth_engine',
	'the_big_change',
	'proof_points',
	'what_can_kill_it',
	'why_we_believe_it',
	'health_check',
	'references',
	'general'
] as const;

const guidanceIn = z.object({
	block_key: z.enum(BLOCK_KEYS),
	note: z.string().min(1),
	target_metric: z.enum(['revenue', 'margin', 'other']).nullish(),
	target_metric_label: z.string().max(60).nullish(),
	target_value: z.number().nullish(),
	target_unit: z.string().max(20).nullish(),
	target_period: z.string().max(20).nullish(),
	expected_results_date: z.string().date().nullish()
});

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
		const body = await request.json();
		const parsed = guidanceIn.safeParse(body);
		if (!parsed.success) return errorResponse(422, zodErrorMessage(parsed.error));

		const { note, companyName } = await createGuidance(params.id!, parsed.data.block_key, parsed.data.note, actor.identity, {
			targetMetric: parsed.data.target_metric,
			targetMetricLabel: parsed.data.target_metric_label,
			targetValue: parsed.data.target_value,
			targetUnit: parsed.data.target_unit,
			targetPeriod: parsed.data.target_period,
			expectedResultsDate: parsed.data.expected_results_date
		});
		return json(toOut(note, companyName), { status: 201 });
	} catch (err) {
		if (err instanceof NotFoundError) return errorResponse(404, err.message);
		return handleAuthError(err);
	}
};
