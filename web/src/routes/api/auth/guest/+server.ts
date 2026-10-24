import { redirect } from '@sveltejs/kit';
import { dev } from '$app/environment';
import type { RequestHandler } from './$types';
import { GUEST_COOKIE, GUEST_TTL_SECONDS } from '$lib/guest';

// "Explore without an account" on the sign-in page. The cookie only marks the browser as a guest;
// it grants nothing a guest could not get by asking for it, so it needs no signature. A real
// session, when there is one, always takes precedence (hooks.server.ts).
export const POST: RequestHandler = ({ cookies }) => {
	cookies.set(GUEST_COOKIE, '1', {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure: !dev,
		maxAge: GUEST_TTL_SECONDS
	});
	redirect(303, '/');
};
