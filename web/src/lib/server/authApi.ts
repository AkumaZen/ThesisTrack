import { error, json } from '@sveltejs/kit';
import { AuthError } from './accounts';

/** Runs an auth/admin mutation, mapping expected failures to their 4xx status. */
export async function handleAuth<T>(fn: () => Promise<T>, status = 200): Promise<Response> {
	try {
		return json(await fn(), { status });
	} catch (e) {
		if (e instanceof AuthError) error(e.status, e.message);
		throw e;
	}
}

export async function readJson(request: Request): Promise<Record<string, unknown>> {
	try {
		const body = await request.json();
		if (typeof body === 'object' && body !== null && !Array.isArray(body)) {
			return body as Record<string, unknown>;
		}
	} catch {
		// fall through
	}
	error(400, 'Expected a JSON object body.');
}

/** Defence in depth: hooks.server.ts already blocks non-admins, but a handler that is ever
 *  mounted somewhere the hook's path rules do not cover must still refuse them. */
export function requireAdmin(locals: App.Locals) {
	if (!locals.user) error(401, 'Sign in required.');
	if (locals.user.role !== 'admin') error(403, 'This action is limited to the admin.');
	return locals.user;
}
