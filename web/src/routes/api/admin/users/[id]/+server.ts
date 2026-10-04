import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { handleAuth, readJson, requireAdmin } from '$lib/server/authApi';
import { deleteUser, setRole } from '$lib/server/accounts';
import { ROLES, type Role } from '$lib/auth';

function idOf(raw: string): number {
	const id = Number(raw);
	if (!Number.isInteger(id)) error(400, 'Invalid user id.');
	return id;
}

/** Body: { role }. */
export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	const admin = requireAdmin(locals);
	const body = await readJson(request);
	if (!ROLES.includes(body.role as Role)) error(400, 'Unknown role.');
	return handleAuth(() => setRole(idOf(params.id), body.role as Role, admin.id));
};

export const DELETE: RequestHandler = async ({ params, locals }) => {
	const admin = requireAdmin(locals);
	return handleAuth(async () => ({ removed: (await deleteUser(idOf(params.id), admin.id)).username }));
};
