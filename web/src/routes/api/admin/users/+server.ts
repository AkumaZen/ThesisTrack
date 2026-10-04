import type { RequestHandler } from './$types';
import { handleAuth, readJson, requireAdmin } from '$lib/server/authApi';
import { createUser, listUsers } from '$lib/server/accounts';
import { ROLES, type Role } from '$lib/auth';

export const GET: RequestHandler = async ({ locals }) => {
	requireAdmin(locals);
	return handleAuth(() => listUsers());
};

/** Body: { email, displayName?, role, password? }. Omit password to generate one. The temporary
 *  password is returned exactly once, here - it is never retrievable afterwards. */
export const POST: RequestHandler = async ({ request, locals }) => {
	requireAdmin(locals);
	const body = await readJson(request);
	const role = ROLES.includes(body.role as Role) ? (body.role as Role) : 'read_write';
	return handleAuth(
		() =>
			createUser({
				email: String(body.email ?? ''),
				displayName: typeof body.displayName === 'string' ? body.displayName : undefined,
				role,
				password: typeof body.password === 'string' ? body.password : undefined
			}),
		201
	);
};
