// Team scorecard: every analyst's theses with returns from STORED prices. Read-only.
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { handleAuthError, requireActor } from '$lib/server/http';
import { buildScorecard } from '$lib/server/services/scorecardData';

export const GET: RequestHandler = async ({ locals }) => {
	try {
		requireActor(locals.actor);
		return json(await buildScorecard());
	} catch (err) {
		return handleAuthError(err);
	}
};
