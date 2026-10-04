import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { handleAuth, requireAdmin } from '$lib/server/authApi';
import { deleteUser } from '$lib/server/authStore';

export const DELETE: RequestHandler = async ({ params, locals }) => {
	const admin = requireAdmin(locals);
	const id = Number(params.id);
	if (!Number.isInteger(id)) error(400, 'Invalid user id.');
	return handleAuth(async () => ({ removed: (await deleteUser(id, admin.id)).username }));
};
