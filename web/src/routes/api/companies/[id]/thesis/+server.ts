// Ports PUT /api/companies/{id}/thesis from app/routers/companies.py.
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireWriteActor, errorResponse, handleAuthError, zodErrorMessage } from '$lib/server/http';
import { thesisData } from '$lib/server/schemas/thesis';
import { amendThesis, NotFoundError } from '$lib/server/services/versioning';
import { ScenarioNotFoundError } from '$lib/server/services/scenarios';

export const PUT: RequestHandler = async ({ locals, params, request }) => {
	try {
		const actor = requireWriteActor(locals.actor);
		const body = await request.json();
		const parsed = thesisData.safeParse(body.thesis_data);
		if (!parsed.success) return errorResponse(422, zodErrorMessage(parsed.error));

		const version = await amendThesis(params.id!, parsed.data, body.change_note, actor.identity);
		return json({
			version_id: version.versionId,
			version_no: version.versionNo,
			change_note: version.changeNote,
			authored_by: version.authoredBy,
			authored_at: version.authoredAt,
			thesis_data: version.thesisData
		});
	} catch (err) {
		if (err instanceof NotFoundError || err instanceof ScenarioNotFoundError) return errorResponse(404, err.message);
		return handleAuthError(err);
	}
};
