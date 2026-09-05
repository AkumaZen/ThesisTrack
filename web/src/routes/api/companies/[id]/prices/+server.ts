// Ports GET/POST /api/companies/{id}/prices from app/routers/price.py.
import { json } from '@sveltejs/kit';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { requireActor, requireWriteActor, errorResponse, handleAuthError, zodErrorMessage } from '$lib/server/http';
import { listPrices, logPrice, NotFoundError } from '$lib/server/services/pricePerformance';

const priceIn = z.object({
	observed_on: z.string(),
	price: z.number().gt(0)
});

function toOut(p: {
	id: number;
	companyId: string;
	observedOn: string;
	price: string;
	source: string;
	actor: string;
	createdAt: Date;
}) {
	return {
		id: p.id,
		company_id: p.companyId,
		observed_on: p.observedOn,
		price: Number(p.price),
		source: p.source,
		actor: p.actor,
		created_at: p.createdAt
	};
}

export const POST: RequestHandler = async ({ locals, params, request }) => {
	try {
		const actor = requireWriteActor(locals.actor);
		const body = await request.json();
		const parsed = priceIn.safeParse(body);
		if (!parsed.success) return errorResponse(422, zodErrorMessage(parsed.error));

		const price = await logPrice(params.id!, parsed.data.observed_on, parsed.data.price, actor.identity);
		return json(toOut(price), { status: 201 });
	} catch (err) {
		if (err instanceof NotFoundError) return errorResponse(404, err.message);
		return handleAuthError(err);
	}
};

export const GET: RequestHandler = async ({ locals, params }) => {
	try {
		requireActor(locals.actor);
		const rows = await listPrices(params.id!);
		return json(rows.map(toOut));
	} catch (err) {
		return handleAuthError(err);
	}
};
