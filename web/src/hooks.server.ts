import { env } from '$env/dynamic/private';
import { randomUUID } from 'node:crypto';
import { json, redirect, type Handle, type HandleServerError } from '@sveltejs/kit';
import { building } from '$app/environment';
import { getSessionUser } from '$lib/server/accounts';
import { hasApiCredential, resolveActor } from '$lib/server/auth';
import { SESSION_COOKIE } from '$lib/auth';
import { decideAccess, isApiPath } from '$lib/access';
import { startSectorRotationScheduler } from '$lib/valuation/server/sectorRotationScheduler';
import { startAlertScheduler } from '$lib/valuation/server/alertScheduler';
import { IDLE_GRACE_MS, holdIdleConnections } from '$lib/server/db';
import { isTrackerTestRequest, mockCompanies } from '$lib/valuation/server/masterTrackerMock';

// Background jobs for the valuation tools: refresh the stored prices four times each weekday
// (see refreshSlots.ts) and check prices against fair value every 10 min in market hours. A long-running server (local
// dev, a container) runs them in-process; on Vercel there is no long-running process, so
// vercel.json's crons call /api/cron/* instead. DISABLE_BACKGROUND_JOBS turns both off (tests).
if (!building && !env.VERCEL && env.DISABLE_BACKGROUND_JOBS !== 'true') {
	startSectorRotationScheduler();
	startAlertScheduler();
}

/**
 * Vercel freezes an instance as soon as it has replied, and a frozen instance cannot run the
 * database client's idle timer - so its connection would stay open (and counted against the
 * database's small connection limit) until the instance is thrown away. Asking Vercel to keep the
 * instance awake for a moment after the reply lets that timer close the connection first. This is
 * the same request-context hook the @vercel/functions `waitUntil` helper uses. Only needed when the
 * database is reached directly; behind the Neon pooler (see lib/server/db) it does nothing.
 */
function holdInstanceForIdleConnections() {
	if (!holdIdleConnections) return;
	const context = (globalThis as Record<symbol, unknown>)[Symbol.for('@vercel/request-context')] as
		| { get?: () => { waitUntil?: (promise: Promise<unknown>) => void } | undefined }
		| undefined;
	context?.get?.()?.waitUntil?.(new Promise((done) => setTimeout(done, IDLE_GRACE_MS)));
}

/**
 * Every request: resolve the session cookie to a user (or a script's API key / bearer token to
 * an actor), then apply the single access policy in lib/access.ts. Signed-out page loads go to
 * /login (remembering where they were headed); signed-out API calls get a 401 instead of a
 * redirect so fetch() callers see a real error.
 */
export const handle: Handle = async ({ event, resolve }) => {
	// Local Playwright harness: scoped to Master Tracker and the Compare page (whose figures the
	// spec serves itself), unavailable in production builds.
	const mockScope = event.url.pathname.startsWith('/valuation/master-tracker') || event.url.pathname === '/valuation/compare' || event.url.pathname.startsWith('/api/valuation/master-tracker') || (event.request.method === 'GET' && event.url.pathname.startsWith('/api/valuation/valuations')) || ['/api/valuation/symbol-search', '/api/valuation/alerts/unread-count'].includes(event.url.pathname);
	if (mockScope && isTrackerTestRequest(event.url)) {
		const role = event.cookies.get('tracker-test-role') === 'read_only' ? 'read_only' : 'read_write';
		event.locals.user = { id: event.cookies.get('tracker-test-user') === 'second' ? 900002 : 900001, username: 'Playwright.Test', email: 'test@example.invalid', role, mustChangePassword: false };
		const decision = decideAccess({ pathname: event.url.pathname, method: event.request.method, user: event.locals.user, hasApiCredential: false });
		if (decision === 'forbidden') return json({ message: 'You do not have access to this action.' }, { status: 403 });
		if (event.url.pathname === '/api/valuation/symbol-search') { const q = (event.url.searchParams.get('q') ?? '').toLowerCase(); return json({ results: mockCompanies.filter((c) => `${c.name} ${c.symbol}`.toLowerCase().includes(q)) }); }
		if (event.url.pathname === '/api/valuation/alerts/unread-count') return json({ count: 0 });
		return resolve(event);
	}
	const token = event.cookies.get(SESSION_COOKIE) ?? null;
	event.locals.sessionToken = token;
	event.locals.user = await getSessionUser(token ?? undefined);
	try {
		event.locals.actor = await resolveActor(event.request.headers, event.locals.user);
	} catch {
		// Not resolvable means "no actor"; thesis routes that need one return their own 401.
		event.locals.actor = null;
	}

	const { pathname, search } = event.url;
	const decision = decideAccess({
		pathname,
		method: event.request.method,
		user: event.locals.user,
		hasApiCredential: hasApiCredential(event.request.headers)
	});

	if (decision === 'login') {
		if (isApiPath(pathname)) return json({ message: 'Sign in required.', detail: 'Sign in required.' }, { status: 401 });
		const next = encodeURIComponent(pathname + search);
		redirect(303, pathname === '/' ? '/login' : `/login?next=${next}`);
	}
	if (decision === 'change-password') {
		if (isApiPath(pathname)) {
			const message = 'Change your temporary password first.';
			return json({ message, detail: message }, { status: 403 });
		}
		redirect(303, '/account/password');
	}
	if (decision === 'forbidden') {
		if (isApiPath(pathname)) {
			const message = 'You do not have access to this action.';
			return json({ message, detail: message }, { status: 403 });
		}
		return new Response('Forbidden: this page is limited to the admin.', {
			status: 403,
			headers: { 'content-type': 'text/plain; charset=utf-8' }
		});
	}

	const response = await resolve(event);
	holdInstanceForIdleConnections();
	return response;
};

/**
 * Unexpected errors (anything that isn't a deliberate `error(4xx/5xx)`): one log line with an id,
 * the request and the user, and the same id on the error page so a screenshot can be matched to
 * the log. The raw message is never shown to the user.
 */
export const handleError: HandleServerError = ({ error, event, status, message }) => {
	const errorId = randomUUID().slice(0, 8);
	const who = event.locals.user?.username ?? event.locals.actor?.identity ?? 'signed-out';
	const detail = error instanceof Error ? (error.stack ?? error.message) : String(error);
	console.error(
		`[error ${errorId}] ${status} ${event.request.method} ${event.url.pathname} user=${who}\n${detail}`
	);
	return { message, errorId };
};
