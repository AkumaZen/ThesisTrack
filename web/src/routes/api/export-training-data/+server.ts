// Ports GET /api/export-training-data from app/routers/export.py. Streams
// newline-delimited JSON (one training row per line), same as the Python
// StreamingResponse(media_type="application/x-ndjson").
import type { RequestHandler } from './$types';
import { requireActor, errorResponse, handleAuthError } from '$lib/server/http';
import { exportRows } from '$lib/server/services/exporter';

export const GET: RequestHandler = async ({ locals, url }) => {
	try {
		requireActor(locals.actor);

		const task = url.searchParams.get('task');
		if (!task) return errorResponse(422, 'task is required');
		const format = url.searchParams.get('format') ?? 'anthropic';
		const split = url.searchParams.get('split') ?? 'all';
		const minConfidenceParam = url.searchParams.get('min_confidence');
		const minConfidence = minConfidenceParam != null ? Number(minConfidenceParam) : 0;
		const includeOpen = url.searchParams.get('include_open') === 'true';

		let rows: Record<string, unknown>[];
		try {
			rows = await exportRows(task, format, split, includeOpen);
		} catch (exc) {
			return errorResponse(422, exc instanceof Error ? exc.message : String(exc));
		}

		if (minConfidence > 0) {
			rows = rows.filter((r) => {
				const confidence = (r.metadata as { confidence?: number | null }).confidence;
				return confidence == null || confidence >= minConfidence;
			});
		}

		const body = rows.map((row) => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : '');
		return new Response(body, { headers: { 'content-type': 'application/x-ndjson' } });
	} catch (err) {
		return handleAuthError(err);
	}
};
