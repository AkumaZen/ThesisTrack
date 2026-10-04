import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { handleAuth, readJson } from '$lib/server/authApi';
import { changeOwnPassword } from '$lib/server/authStore';

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) error(401, 'Sign in required.');
	const body = await readJson(request);
	const user = locals.user;
	return handleAuth(async () => {
		await changeOwnPassword(
			user.id,
			String(body.currentPassword ?? ''),
			String(body.newPassword ?? ''),
			locals.sessionToken
		);
		return { ok: true };
	});
};
