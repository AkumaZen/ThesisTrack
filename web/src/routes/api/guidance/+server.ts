// Ports GET /api/guidance from app/routers/guidance.py.
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireActor, handleAuthError } from '$lib/server/http';
import { listGuidance } from '$lib/server/services/guidance';

export const GET: RequestHandler = async ({ locals, url }) => {
	try {
		const actor = requireActor(locals.actor);
		const companyId = url.searchParams.get('company_id');
		const blockKey = url.searchParams.get('block_key');
		const status = url.searchParams.get('status');
		// This is the shared /guidance tab's feed - guidance notes are
		// per-analyst, so it only ever shows the actor's own notes (never
		// another teammate's), regardless of what filters are applied. Seeing
		// someone else's guidance happens on their company card/detail view
		// instead, via /api/companies and /api/companies/:id.
		const rows = await listGuidance(companyId, blockKey, status, actor.identity);
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
				resolved_at: note.resolvedAt,
				target_metric: note.targetMetric,
				target_metric_label: note.targetMetricLabel,
				target_value: note.targetValue != null ? Number(note.targetValue) : null,
				target_unit: note.targetUnit,
				target_period: note.targetPeriod,
				expected_results_date: note.expectedResultsDate,
				outcome: note.outcome
			}))
		);
	} catch (err) {
		return handleAuthError(err);
	}
};
