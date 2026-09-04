import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireActor } from '$lib/server/http';
import { handleAuthError } from '$lib/server/http';

export const GET: RequestHandler = async ({ locals }) => {
	try {
		const actor = requireActor(locals.actor);
		return json({ identity: actor.identity, role: actor.role, source: actor.source });
	} catch (err) {
		return handleAuthError(err);
	}
};
