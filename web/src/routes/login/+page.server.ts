import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { SESSION_COOKIE, normalizeEmail, safeNextPath } from '$lib/auth';
import { authenticate, createSession } from '$lib/server/accounts';
import { loginThrottle } from '$lib/server/loginThrottle';

export const load: PageServerLoad = ({ locals, url }) => {
	if (locals.user) redirect(303, safeNextPath(url.searchParams.get('next')));
	return { next: url.searchParams.get('next') ?? '' };
};

export const actions: Actions = {
	default: async ({ request, cookies, url }) => {
		const form = await request.formData();
		const email = String(form.get('email') ?? '').trim();
		const password = String(form.get('password') ?? '');
		const next = String(form.get('next') ?? '');

		const key = normalizeEmail(email);
		const waitMs = loginThrottle.retryAfterMs(key);
		if (waitMs > 0) {
			const mins = Math.ceil(waitMs / 60_000);
			return fail(429, {
				email,
				error: `Too many failed attempts. Try again in ${mins} minute${mins === 1 ? '' : 's'}.`
			});
		}

		const user = email && password ? await authenticate(email, password) : null;
		if (!user) {
			loginThrottle.recordFailure(key);
			// Same message whether the account exists or not.
			return fail(400, { email, error: 'Incorrect email or password.' });
		}

		loginThrottle.recordSuccess(key);
		const { token, expiresAt } = await createSession(user.id);
		cookies.set(SESSION_COOKIE, token, {
			path: '/',
			httpOnly: true,
			sameSite: 'lax',
			secure: url.protocol === 'https:',
			expires: new Date(expiresAt)
		});
		redirect(303, user.mustChangePassword ? '/account/password' : safeNextPath(next));
	}
};
