// Ports DELETE /api/guidance/{id} from app/routers/guidance.py.
import type { RequestHandler } from './$types';
import { requireWriteActor, errorResponse, handleAuthError } from '$lib/server/http';
import { deleteGuidance } from '$lib/server/services/guidance';

export const DELETE: RequestHandler = async ({ locals, params }) => {
	try {
		requireWriteActor(locals.actor);
		const id = Number(params.id);
		const ok = await deleteGuidance(id);
		if (!ok) return errorResponse(404, `guidance note ${id} not found`);
		return new Response(null, { status: 204 });
	} catch (err) {
		return handleAuthError(err);
	}
};
