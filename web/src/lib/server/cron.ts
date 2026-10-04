import { error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';

/** Vercel Cron sends `Authorization: Bearer $CRON_SECRET`. Without a configured secret the cron
 *  endpoints stay shut, so nobody can trigger the (slow, rate-limited) jobs from outside. */
export function requireCronSecret(request: Request) {
	const secret = env.CRON_SECRET;
	if (!secret) error(503, 'CRON_SECRET is not configured.');
	if (request.headers.get('authorization') !== `Bearer ${secret}`) error(401, 'Bad cron secret.');
}
