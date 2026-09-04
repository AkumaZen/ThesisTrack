// DELETE /api/sectors/{id}/companies/{companyId} - remove one company from a sector.
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { errorResponse, requireWriteActor, handleAuthError } from '$lib/server/http';
import { NotFoundError, removeCompanyFromSector } from '$lib/server/services/sectors';

export const DELETE: RequestHandler = async ({ locals, params }) => {
	try {
		requireWriteActor(locals.actor);
		const sector = await removeCompanyFromSector(Number(params.id), params.companyId!);
		return json(sector);
	} catch (err) {
		if (err instanceof NotFoundError) return errorResponse(404, err.message);
		return handleAuthError(err);
	}
};
