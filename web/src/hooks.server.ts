import type { Handle } from '@sveltejs/kit';
import { resolveActor } from '$lib/server/auth';

// Resolves the actor for every request (mirrors get_current_actor being a
// FastAPI dependency on nearly every route) - stored on locals so
// +server.ts handlers can check it (and call requireWrite) without
// re-parsing headers themselves. Resolution failure just means "no actor
// yet" here; routes that require one throw their own 401.
export const handle: Handle = async ({ event, resolve }) => {
	try {
		event.locals.actor = await resolveActor(event.request.headers);
	} catch {
		event.locals.actor = null;
	}
	return resolve(event);
};
