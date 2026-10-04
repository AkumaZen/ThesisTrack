// Pure auth helpers shared by the server and unit tests - no I/O.

export type Role = 'admin' | 'member';

export interface SessionUser {
	id: number;
	username: string;
	role: Role;
	/** True right after an admin created/reset the account: the user must pick their own
	 *  password before using anything else. */
	mustChangePassword: boolean;
}

export const SESSION_COOKIE = 'vd_session';
export const SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1000;

/** Display usernames look like "Rohit.Negi". Logins are matched case-insensitively. */
const USERNAME_RE = /^[A-Za-z][A-Za-z0-9._-]{1,31}$/;

export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 128;

export function normalizeUsername(raw: string): string {
	return raw.trim().toLowerCase();
}

/** Returns an error message, or null when the username is acceptable. */
export function validateUsername(raw: unknown): string | null {
	if (typeof raw !== 'string' || raw.trim() === '') return 'Enter a username.';
	if (!USERNAME_RE.test(raw.trim())) {
		return 'Usernames are 2-32 characters: letters, numbers, dot, dash or underscore, starting with a letter.';
	}
	return null;
}

/** Returns an error message, or null when the password is acceptable. */
export function validatePassword(raw: unknown): string | null {
	if (typeof raw !== 'string') return 'Enter a password.';
	if (raw.length < MIN_PASSWORD_LENGTH) {
		return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
	}
	if (raw.length > MAX_PASSWORD_LENGTH) return `Password is too long (max ${MAX_PASSWORD_LENGTH}).`;
	return null;
}

/** Only same-site relative paths are honoured after login - never an absolute or
 *  protocol-relative URL, which would turn the login redirect into an open redirect. */
export function safeNextPath(next: string | null | undefined): string {
	if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return '/';
	if (next.startsWith('/login') || next.startsWith('/logout')) return '/';
	return next;
}

/** A user as shown on the admin page - never includes the password hash. */
export interface UserRow {
	id: number;
	username: string;
	role: Role;
	mustChangePassword: boolean;
	createdAt: number;
}

/** Why an account can't be removed, or null if it can. Keeps the team from locking itself out:
 *  you can't remove yourself, and the last admin can never be removed. */
export function removalBlocked(input: {
	targetId: number;
	actingId: number;
	targetRole: Role;
	adminCount: number;
}): string | null {
	if (input.targetId === input.actingId) return "You can't remove your own account.";
	if (input.targetRole === 'admin' && input.adminCount <= 1)
		return "You can't remove the last admin.";
	return null;
}
