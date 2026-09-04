// Ports GET /api/companies/{id}/performance from app/routers/price.py.
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireActor, errorResponse, handleAuthError } from '$lib/server/http';
import { computePerformance, NotFoundError } from '$lib/server/services/pricePerformance';

export const GET: RequestHandler = async ({ locals, params, url }) => {
	try {
		const actor = requireActor(locals.actor);
		const baseline = (url.searchParams.get('baseline') ?? 'thesis') as 'thesis' | 'decision';
		if (baseline !== 'thesis' && baseline !== 'decision') {
			return errorResponse(422, "baseline must be 'thesis' or 'decision'");
		}
		const result = await computePerformance(params.id!, baseline, actor.identity);
		return json(result);
	} catch (err) {
		if (err instanceof NotFoundError) return errorResponse(404, err.message);
		return handleAuthError(err);
	}
};
