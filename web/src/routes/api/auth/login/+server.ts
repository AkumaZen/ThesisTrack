import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticate, issueToken } from '$lib/server/auth';
import { handleAuthError } from '$lib/server/http';

export const POST: RequestHandler = async ({ request }) => {
	const { email, password } = await request.json();
	try {
		const user = await authenticate(email, password);
		const access_token = await issueToken(user.email, user.role);
		return json({ access_token, email: user.email, role: user.role });
	} catch (err) {
		return handleAuthError(err);
	}
};
