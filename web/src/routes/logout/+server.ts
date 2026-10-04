import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { SESSION_COOKIE } from '$lib/auth';
import { deleteSession } from '$lib/server/authStore';

// POST only: a plain link (GET) must never be able to sign someone out, e.g. via an <img> tag.
export const POST: RequestHandler = async ({ cookies }) => {
	const token = cookies.get(SESSION_COOKIE);
	if (token) await deleteSession(token);
	cookies.delete(SESSION_COOKIE, { path: '/' });
	redirect(303, '/login');
};
