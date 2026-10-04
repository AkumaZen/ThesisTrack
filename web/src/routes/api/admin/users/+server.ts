import type { RequestHandler } from './$types';
import { handleAuth, readJson, requireAdmin } from '$lib/server/authApi';
import { createUser, listUsers } from '$lib/server/authStore';

export const GET: RequestHandler = async ({ locals }) => {
	requireAdmin(locals);
	return handleAuth(() => listUsers());
};

/** Body: { username, role: "admin" | "member", password? }. Omit password to generate one. The
 *  temporary password is returned exactly once, here - it is never retrievable afterwards. */
export const POST: RequestHandler = async ({ request, locals }) => {
	requireAdmin(locals);
	const body = await readJson(request);
	return handleAuth(
		() =>
			createUser({
				username: String(body.username ?? ''),
				role: body.role === 'admin' ? 'admin' : 'member',
				password: typeof body.password === 'string' ? body.password : undefined
			}),
		201
	);
};
