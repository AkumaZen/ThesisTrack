// People and browser sessions for the whole app (thesis + valuation tools share one login).
import { and, asc, eq, lt, ne, sql } from 'drizzle-orm';
import { db } from './db';
import { sessions, users } from './db/schema';
import {
	ROLES,
	SESSION_TTL_MS,
	displayNameFromEmail,
	normalizeEmail,
	removalBlocked,
	validateDisplayName,
	validateEmail,
	validatePassword,
	type Role,
	type SessionUser,
	type UserRow
} from '../auth';
import {
	generateTemporaryPassword,
	hashPassword,
	hashToken,
	newSessionToken,
	verifyPassword
} from './password';

/** An expected, user-facing failure (bad input, duplicate, guarded action). The API layer turns
 *  it into a 4xx with this message; anything else stays a 500. */
export class AuthError extends Error {
	constructor(
		public status: 400 | 403 | 404 | 409,
		message: string
	) {
		super(message);
	}
}

const toRow = (r: typeof users.$inferSelect): UserRow => ({
	id: r.id,
	email: r.email,
	username: r.displayName,
	role: r.role as Role,
	mustChangePassword: r.mustChangePassword,
	isActive: r.isActive,
	createdAt: r.createdAt.getTime(),
	lastLoginAt: r.lastLoginAt ? r.lastLoginAt.getTime() : null
});

const toSessionUser = (r: typeof users.$inferSelect): SessionUser => ({
	id: r.id,
	email: r.email,
	username: r.displayName,
	role: r.role as Role,
	mustChangePassword: r.mustChangePassword
});

// ---------------------------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------------------------

/** Active accounts only - a removed account is kept (theses and valuation history still name
 *  its owner) but never listed or able to sign in. */
export async function listUsers(): Promise<UserRow[]> {
	const rows = await db
		.select()
		.from(users)
		.where(eq(users.isActive, true))
		.orderBy(asc(users.createdAt), asc(users.id));
	return rows.map(toRow);
}

export async function createUser(input: {
	email: string;
	displayName?: string;
	role: Role;
	/** Omit to have a temporary password generated. */
	password?: string;
}): Promise<{ user: UserRow; temporaryPassword: string }> {
	const emailError = validateEmail(input.email);
	if (emailError) throw new AuthError(400, emailError);
	const email = normalizeEmail(input.email);
	const displayName = input.displayName?.trim() || displayNameFromEmail(email);
	const nameError = validateDisplayName(displayName);
	if (nameError) throw new AuthError(400, nameError);
	if (!ROLES.includes(input.role)) throw new AuthError(400, 'Unknown role.');

	const temporaryPassword = input.password?.trim() ? input.password : generateTemporaryPassword();
	const passwordError = validatePassword(temporaryPassword);
	if (passwordError) throw new AuthError(400, passwordError);

	const [existing] = await db.select().from(users).where(eq(users.email, email));
	const [sameName] = await db
		.select({ id: users.id })
		.from(users)
		.where(sql`lower(${users.displayName}) = lower(${displayName})`);
	if (sameName && sameName.id !== existing?.id) {
		throw new AuthError(409, `Someone is already shown as "${displayName}". Pick another display name.`);
	}
	if (existing?.isActive) throw new AuthError(409, `${email} already has an account.`);

	const values = {
		email,
		displayName,
		passwordHash: await hashPassword(temporaryPassword),
		role: input.role,
		isActive: true,
		// A password someone else chose is only ever temporary.
		mustChangePassword: true
	};
	// A previously removed account comes back (same id, so its history reattaches).
	const [row] = existing
		? await db.update(users).set(values).where(eq(users.id, existing.id)).returning()
		: await db.insert(users).values(values).returning();
	return { user: toRow(row), temporaryPassword };
}

async function adminCount(): Promise<number> {
	const [{ n }] = await db
		.select({ n: sql<number>`count(*)::int` })
		.from(users)
		.where(and(eq(users.role, 'admin'), eq(users.isActive, true)));
	return n;
}

/** Removes the account from the team and signs it out everywhere, immediately. */
export async function deleteUser(id: number, actingUserId: number): Promise<UserRow> {
	const [target] = await db.select().from(users).where(eq(users.id, id));
	if (!target || !target.isActive) throw new AuthError(404, 'No such user.');
	const blocked = removalBlocked({
		targetId: id,
		actingId: actingUserId,
		targetRole: target.role as Role,
		adminCount: await adminCount()
	});
	if (blocked) throw new AuthError(403, blocked);
	await db.update(users).set({ isActive: false }).where(eq(users.id, id));
	await db.delete(sessions).where(eq(sessions.userId, id));
	return toRow(target);
}

/** Changes someone's role. The last admin can't be demoted, or nobody could manage the team. */
export async function setRole(id: number, role: Role, actingUserId: number): Promise<UserRow> {
	if (!ROLES.includes(role)) throw new AuthError(400, 'Unknown role.');
	const [target] = await db.select().from(users).where(eq(users.id, id));
	if (!target || !target.isActive) throw new AuthError(404, 'No such user.');
	if (target.role === 'admin' && role !== 'admin') {
		if (id === actingUserId) throw new AuthError(403, "You can't remove your own admin role.");
		if ((await adminCount()) <= 1) throw new AuthError(403, "You can't demote the last admin.");
	}
	const [row] = await db.update(users).set({ role }).where(eq(users.id, id)).returning();
	return toRow(row);
}

/** Admin reset: sets a new temporary password, forces a change on next login, and signs the
 *  user out everywhere. */
export async function resetPassword(
	id: number,
	password?: string
): Promise<{ user: UserRow; temporaryPassword: string }> {
	const temporaryPassword = password?.trim() ? password : generateTemporaryPassword();
	const error = validatePassword(temporaryPassword);
	if (error) throw new AuthError(400, error);

	const [row] = await db
		.update(users)
		.set({ passwordHash: await hashPassword(temporaryPassword), mustChangePassword: true })
		.where(and(eq(users.id, id), eq(users.isActive, true)))
		.returning();
	if (!row) throw new AuthError(404, 'No such user.');
	await db.delete(sessions).where(eq(sessions.userId, id));
	return { user: toRow(row), temporaryPassword };
}

/** Self-service change. Other devices are signed out; the current session stays. */
export async function changeOwnPassword(
	userId: number,
	currentPassword: string,
	newPassword: string,
	keepSessionToken: string | null
): Promise<void> {
	const [row] = await db.select().from(users).where(eq(users.id, userId));
	if (!row) throw new AuthError(404, 'No such user.');
	if (!(await verifyPassword(currentPassword, row.passwordHash))) {
		throw new AuthError(403, 'Current password is incorrect.');
	}
	const error = validatePassword(newPassword);
	if (error) throw new AuthError(400, error);
	if (newPassword === currentPassword) {
		throw new AuthError(400, 'Choose a password different from the current one.');
	}
	await db
		.update(users)
		.set({ passwordHash: await hashPassword(newPassword), mustChangePassword: false })
		.where(eq(users.id, userId));
	const keep = keepSessionToken ? hashToken(keepSessionToken) : '';
	await db.delete(sessions).where(and(eq(sessions.userId, userId), ne(sessions.tokenHash, keep)));
}

// ---------------------------------------------------------------------------------------------
// Login and sessions
// ---------------------------------------------------------------------------------------------

// Verifying against this when the email doesn't exist keeps response time similar for
// "no such user" and "wrong password", so login can't be used to discover which emails exist.
let dummyHash: Promise<string> | null = null;
const getDummyHash = () => (dummyHash ??= hashPassword('not-a-real-password'));

/** Returns the user on success, null on any failure (deliberately indistinguishable). */
export async function authenticate(email: string, password: string): Promise<SessionUser | null> {
	const [row] = await db.select().from(users).where(eq(users.email, normalizeEmail(email)));
	const ok = await verifyPassword(password, row?.passwordHash ?? (await getDummyHash()));
	if (!row || !ok || !row.isActive) return null;
	await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, row.id));
	return toSessionUser(row);
}

export async function createSession(userId: number): Promise<{ token: string; expiresAt: number }> {
	const token = newSessionToken();
	const now = Date.now();
	const expiresAt = now + SESSION_TTL_MS;
	await db
		.insert(sessions)
		.values({ tokenHash: hashToken(token), userId, createdAt: now, expiresAt });
	// Opportunistic housekeeping: expired sessions are useless, drop them.
	await db.delete(sessions).where(lt(sessions.expiresAt, now));
	return { token, expiresAt };
}

export async function getSessionUser(token: string | undefined): Promise<SessionUser | null> {
	if (!token) return null;
	const [row] = await db
		.select({ user: users, expiresAt: sessions.expiresAt })
		.from(sessions)
		.innerJoin(users, eq(sessions.userId, users.id))
		.where(eq(sessions.tokenHash, hashToken(token)));
	if (!row || !row.user.isActive) return null;
	if (row.expiresAt <= Date.now()) {
		await deleteSession(token);
		return null;
	}
	return toSessionUser(row.user);
}

export async function deleteSession(token: string): Promise<void> {
	await db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token)));
}
