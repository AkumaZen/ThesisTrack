import type { SessionUser } from './auth';

// The whole access policy in one pure function, so every rule is unit-tested and the hook that
// enforces it stays a thin wrapper. Anything not listed as public needs a signed-in user.

export type AccessDecision = 'allow' | 'login' | 'forbidden' | 'change-password';

// /healthz reveals nothing but up/down, for the load balancer and uptime checks.
const PUBLIC_PATHS = ['/login', '/logout', '/healthz'];

/** Pages only the admin may open (they edit shared configuration or manage people). */
const ADMIN_PAGE_PREFIXES = ['/admin', '/sectors'];

/** API areas whose WRITES are admin-only (reads stay open to every signed-in user). */
const ADMIN_WRITE_API_PREFIXES = ['/api/sectors', '/api/sector-rotation-import'];

/** API areas that are admin-only entirely, reads included. */
const ADMIN_API_PREFIXES = ['/api/admin'];

/** Reachable while the password still has to be changed. */
const CHANGE_PASSWORD_ALLOWED = ['/account/password', '/api/account/password', '/logout'];

const startsWithPath = (pathname: string, prefix: string) =>
	pathname === prefix || pathname.startsWith(prefix + '/');

const isRead = (method: string) => method === 'GET' || method === 'HEAD';

export function decideAccess(input: {
	pathname: string;
	method: string;
	user: SessionUser | null;
}): AccessDecision {
	const { pathname, method, user } = input;
	// A path with a ".." segment is never treated as public, even though the URL parser normally
	// collapses it before we see it - the guard shouldn't depend on that.
	const traversal = pathname.split('/').includes('..');
	if (!traversal && PUBLIC_PATHS.some((p) => startsWithPath(pathname, p))) return 'allow';
	if (!user) return 'login';

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
	return 'allow';
}

export const isApiPath = (pathname: string) => startsWithPath(pathname, '/api');
