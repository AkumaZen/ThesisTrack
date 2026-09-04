// Ports GET /api/export-training-data/stats from app/routers/export.py.
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireActor, handleAuthError } from '$lib/server/http';
import { exportStats } from '$lib/server/services/exporter';

export const GET: RequestHandler = async ({ locals, url }) => {
	try {
		requireActor(locals.actor);
		const split = url.searchParams.get('split') ?? 'all';
		const includeOpen = url.searchParams.get('include_open') === 'true';
		const stats = await exportStats(split, includeOpen);
		return json(stats);
	} catch (err) {
		return handleAuthError(err);
	}
};
