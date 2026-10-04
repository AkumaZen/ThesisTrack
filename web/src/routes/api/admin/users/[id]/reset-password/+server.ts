import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { handleAuth, readJson, requireAdmin } from '$lib/server/authApi';
import { resetPassword } from '$lib/server/accounts';

/** Body: { password? } - omit to generate. Signs the user out everywhere and forces a change. */
export const POST: RequestHandler = async ({ params, request, locals }) => {
	requireAdmin(locals);
	const id = Number(params.id);
	if (!Number.isInteger(id)) error(400, 'Invalid user id.');
	const body = await readJson(request).catch(() => ({}) as Record<string, unknown>);
	return handleAuth(() =>
		resetPassword(id, typeof body.password === 'string' ? body.password : undefined)
	);
};
