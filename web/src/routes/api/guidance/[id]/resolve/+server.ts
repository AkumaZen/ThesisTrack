// Ports POST /api/guidance/{id}/resolve from app/routers/guidance.py.
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireWriteActor, errorResponse, handleAuthError } from '$lib/server/http';
import { resolveGuidance } from '$lib/server/services/guidance';

export const POST: RequestHandler = async ({ locals, params }) => {
	try {
		const actor = requireWriteActor(locals.actor);
		const id = Number(params.id);
		const result = await resolveGuidance(id, actor.identity);
		if (!result) return errorResponse(404, `guidance note ${id} not found`);
		const { note, companyName } = result;
		return json({
			id: note.id,
			company_id: note.companyId,
			company_name: companyName,
			block_key: note.blockKey,
			note: note.note,
			status: note.status,
			created_by: note.createdBy,
			created_at: note.createdAt,
			resolved_by: note.resolvedBy,
			resolved_at: note.resolvedAt
		});
	} catch (err) {
		return handleAuthError(err);
	}
};
