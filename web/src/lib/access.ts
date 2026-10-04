import type { SessionUser } from './auth';

// The whole access policy in one pure function, so every rule is unit-tested and the hook that
// enforces it stays a thin wrapper. Anything not listed as public needs a signed-in user.

export type AccessDecision = 'allow' | 'login' | 'forbidden' | 'change-password';

/** /api/cron/* checks its own CRON_SECRET (Vercel Cron calls it without a session). */
const PUBLIC_PATHS = ['/login', '/logout', '/api/auth/login', '/api/health', '/api/cron'];

/** Pages only an admin may open (they edit shared configuration or manage people). */
const ADMIN_PAGE_PREFIXES = ['/admin', '/valuation/sectors'];

/** API areas whose WRITES are admin-only (reads stay open to every signed-in user). */
const ADMIN_WRITE_API_PREFIXES = ['/api/valuation/sectors', '/api/valuation/sector-rotation-import'];

/** API areas that are admin-only entirely, reads included. */
const ADMIN_API_PREFIXES = ['/api/admin'];

/** Thesis APIs also accept a script's X-API-Key or Bearer token instead of a browser session;
 *  their handlers check that credential themselves. Everything else needs a real session. */
const SESSION_ONLY_API_PREFIXES = ['/api/valuation', '/api/admin', '/api/account'];

/** Reachable while the password still has to be changed. */
const CHANGE_PASSWORD_ALLOWED = ['/account/password', '/api/account/password', '/logout', '/api/auth/me'];

const startsWithPath = (pathname: string, prefix: string) =>
	pathname === prefix || pathname.startsWith(prefix + '/');

const isRead = (method: string) => method === 'GET' || method === 'HEAD';

export function decideAccess(input: {
	pathname: string;
	method: string;
	user: SessionUser | null;
	/** The request carries an API key or bearer token (scripts, the LLM import pipeline). */
	hasApiCredential?: boolean;
}): AccessDecision {
	const { pathname, method, user } = input;
	// A path with a ".." segment is never treated as public, even though the URL parser normally
	// collapses it before we see it - the guard shouldn't depend on that.
	const traversal = pathname.split('/').includes('..');
	if (!traversal && PUBLIC_PATHS.some((p) => startsWithPath(pathname, p))) return 'allow';

	if (!user) {
		if (
			!traversal &&
			input.hasApiCredential &&
			isApiPath(pathname) &&
			!SESSION_ONLY_API_PREFIXES.some((p) => startsWithPath(pathname, p))
		) {
			return 'allow';
		}
		return 'login';
	}

	if (
		user.mustChangePassword &&
		!CHANGE_PASSWORD_ALLOWED.some((p) => startsWithPath(pathname, p))
	) {
		return 'change-password';
	}

	if (user.role !== 'admin') {
		if (ADMIN_PAGE_PREFIXES.some((p) => startsWithPath(pathname, p))) return 'forbidden';
		if (ADMIN_API_PREFIXES.some((p) => startsWithPath(pathname, p))) return 'forbidden';
		if (!isRead(method) && ADMIN_WRITE_API_PREFIXES.some((p) => startsWithPath(pathname, p))) {
			return 'forbidden';
		}
	}
	// Read-only accounts look at everything and change nothing in the valuation tools. (Thesis
	// API handlers already refuse their writes with requireWrite.)
	if (
		user.role === 'read_only' &&
		!isRead(method) &&
		startsWithPath(pathname, '/api/valuation')
	) {
		return 'forbidden';
	}
	return 'allow';
}

export const isApiPath = (pathname: string) => startsWithPath(pathname, '/api');
