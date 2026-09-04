// Ports POST /api/companies/{id}/observations from app/routers/observations.py.
import { json } from '@sveltejs/kit';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { requireWriteActor, errorResponse, handleAuthError } from '$lib/server/http';
import { postObservations, UnknownMetricError } from '$lib/server/services/observations';
import { NotFoundError } from '$lib/server/services/scenarios';

const PERIOD_PATTERN = /^FY\d{2}Q[1-4]$|^FY\d{2}$/;

const observationIn = z
	.object({
		metric_key: z.string(),
		numeric_value: z.number().nullish(),
		text_value: z.string().nullish(),
		source_type: z.string().nullish(),
		source_url: z.string().nullish(),
		note: z.string().nullish()
	})
	.refine((v) => v.numeric_value != null || v.text_value != null, {
		message: 'observation needs numeric_value or text_value'
	});

const bulkIn = z.object({
	period: z.string().regex(PERIOD_PATTERN),
	period_end: z.string(),
	observations: z.array(observationIn).min(1)
});

export const POST: RequestHandler = async ({ locals, params, request }) => {
	try {
		const actor = requireWriteActor(locals.actor);
		const body = await request.json();
		const parsed = bulkIn.safeParse(body);
		if (!parsed.success) return errorResponse(422, parsed.error.message);

		const result = await postObservations(
			params.id!,
			parsed.data.period,
			parsed.data.period_end,
			parsed.data.observations,
			actor.identity
		);
		return json(result, { status: 201 });
	} catch (err) {
		if (err instanceof NotFoundError) return errorResponse(404, err.message);
		if (err instanceof UnknownMetricError) return errorResponse(422, err.message);
		return handleAuthError(err);
	}
};
