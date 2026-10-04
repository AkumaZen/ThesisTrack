import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { issueToken } from '$lib/server/auth';
import { authenticate } from '$lib/server/accounts';
import { errorResponse } from '$lib/server/http';

// For scripts (the LLM import pipeline, curl): exchanges email + password for a 24h bearer token.
// The browser signs in through the /login page instead, which sets the session cookie.
export const POST: RequestHandler = async ({ request }) => {
	const { email, password } = await request.json().catch(() => ({}));
	const user =
		typeof email === 'string' && typeof password === 'string'
			? await authenticate(email, password)
			: null;
	if (!user) return errorResponse(401, 'invalid email or password');
	const access_token = await issueToken(user.email, user.role);
	return json({ access_token, email: user.email, role: user.role });
};
