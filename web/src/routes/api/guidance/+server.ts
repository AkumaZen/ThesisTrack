// Ports GET /api/guidance from app/routers/guidance.py.
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireActor, handleAuthError } from '$lib/server/http';
import { listGuidance } from '$lib/server/services/guidance';

export const GET: RequestHandler = async ({ locals, url }) => {
	try {
		requireActor(locals.actor);
		const companyId = url.searchParams.get('company_id');
		const blockKey = url.searchParams.get('block_key');
		const status = url.searchParams.get('status');
		const rows = await listGuidance(companyId, blockKey, status);
		return json(
			rows.map(({ note, companyName }) => ({
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
			}))
		);
	} catch (err) {
		return handleAuthError(err);
	}
};
