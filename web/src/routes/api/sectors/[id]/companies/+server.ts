// POST /api/sectors/{id}/companies - add companies to a sector.
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { errorResponse, requireWriteActor, handleAuthError } from '$lib/server/http';
import { addCompaniesSchema } from '$lib/server/schemas/sector';
import { NotFoundError, addCompaniesToSector } from '$lib/server/services/sectors';

export const POST: RequestHandler = async ({ locals, params, request }) => {
	try {
		requireWriteActor(locals.actor);
		const parsed = addCompaniesSchema.safeParse(await request.json());
		if (!parsed.success) return errorResponse(422, parsed.error.message);

		const sector = await addCompaniesToSector(Number(params.id), parsed.data.company_ids);
		return json(sector);
	} catch (err) {
		if (err instanceof NotFoundError) return errorResponse(404, err.message);
		return handleAuthError(err);
	}
};
