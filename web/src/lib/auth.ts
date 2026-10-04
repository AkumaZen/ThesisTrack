// Pure auth helpers shared by the server, the pages and unit tests - no I/O.

/**
 * admin: everything, plus managing people and shared configuration.
 * read_write: the normal analyst account.
 * read_only: can look at everything, change nothing.
 */
export type Role = 'admin' | 'read_write' | 'read_only';
export const ROLES: Role[] = ['admin', 'read_write', 'read_only'];
export const ROLE_LABELS: Record<Role, string> = {
	admin: 'Admin',
	read_write: 'Analyst',
	read_only: 'Read only'
};

export interface SessionUser {
	id: number;
	email: string;
	/** Display name, e.g. "Rohit.Negi" - how the person is shown and how authors are recorded. */
	username: string;
	role: Role;
	/** True right after an admin created/reset the account: the person must pick their own
	 *  password before using anything else. */
	mustChangePassword: boolean;
}

export const SESSION_COOKIE = 'tt_session';
export const SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1000;

export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 128;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** Display names look like "Rohit.Negi". */
const DISPLAY_NAME_RE = /^[A-Za-z][A-Za-z0-9._ -]{1,39}$/;

export const canWrite = (role: Role | null | undefined) => role === 'admin' || role === 'read_write';

export function normalizeEmail(raw: string): string {
	return raw.trim().toLowerCase();
}

/** rohit.negi@rdc.in -> "Rohit.Negi": the default display name for a new account. */
export function displayNameFromEmail(email: string): string {
	return normalizeEmail(email)
		.split('@')[0]
		.split('.')
		.filter(Boolean)
		.map((p) => p.charAt(0).toUpperCase() + p.slice(1))
		.join('.');
}

/** Returns an error message, or null when the email is acceptable. */
export function validateEmail(raw: unknown): string | null {
	if (typeof raw !== 'string' || raw.trim() === '') return 'Enter an email address.';
	if (raw.trim().length > 255 || !EMAIL_RE.test(raw.trim())) return 'Enter a valid email address.';
	return null;
}

/** Returns an error message, or null when the display name is acceptable. */
export function validateDisplayName(raw: unknown): string | null {
	if (typeof raw !== 'string' || raw.trim() === '') return 'Enter a display name.';
	if (!DISPLAY_NAME_RE.test(raw.trim())) {
		return 'Display names are 2-40 characters: letters, numbers, dot, dash, underscore or space, starting with a letter.';
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
	email: string;
	username: string;
	role: Role;
	mustChangePassword: boolean;
	isActive: boolean;
	createdAt: number;
	lastLoginAt: number | null;
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
