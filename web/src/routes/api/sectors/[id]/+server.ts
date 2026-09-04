// GET/PATCH/DELETE /api/sectors/{id}
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { errorResponse, requireActor, requireWriteActor, handleAuthError } from '$lib/server/http';
import { updateSectorSchema } from '$lib/server/schemas/sector';
import { NotFoundError, deleteSector, getSectorById, updateSector } from '$lib/server/services/sectors';

export const GET: RequestHandler = async ({ locals, params }) => {
	try {
		requireActor(locals.actor);
		const sector = await getSectorById(Number(params.id));
		return json(sector);
	} catch (err) {
		if (err instanceof NotFoundError) return errorResponse(404, err.message);
		return handleAuthError(err);
	}
};

export const PATCH: RequestHandler = async ({ locals, params, request }) => {
	try {
		requireWriteActor(locals.actor);
		const parsed = updateSectorSchema.safeParse(await request.json());
		if (!parsed.success) return errorResponse(422, parsed.error.message);

		const sector = await updateSector(Number(params.id), parsed.data);
		return json(sector);
	} catch (err) {
		if (err instanceof NotFoundError) return errorResponse(404, err.message);
		return handleAuthError(err);
	}
};

export const DELETE: RequestHandler = async ({ locals, params }) => {
	try {
		requireWriteActor(locals.actor);
		await deleteSector(Number(params.id));
		return new Response(null, { status: 204 });
	} catch (err) {
		if (err instanceof NotFoundError) return errorResponse(404, err.message);
		return handleAuthError(err);
	}
};
