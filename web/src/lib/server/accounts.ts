import { and, asc, eq, lt, ne, sql } from 'drizzle-orm';
import { env } from '$env/dynamic/private';
import { db } from './db';
import { sessions, users } from './db/schema';
import {
	SESSION_TTL_MS,
	normalizeUsername,
	removalBlocked,
	validatePassword,
	validateUsername,
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
	username: r.username,
	role: r.role as Role,
	mustChangePassword: r.mustChangePassword,
	createdAt: r.createdAt
});

// ---------------------------------------------------------------------------------------------
// Seeding: the very first run (empty users table) creates the two team accounts. Passwords come
// from SEED_ADMIN_PASSWORD / SEED_MEMBER_PASSWORD in .env; if one is missing a random one is
// generated and printed once to the server log. Seeding never runs again once any user exists,
// so those env values are useless afterwards and can be deleted.
// ---------------------------------------------------------------------------------------------

let seeding: Promise<void> | null = null;

export function ensureSeedUsers(): Promise<void> {
	seeding ??= seed().catch((e) => {
		seeding = null;
		throw e;
	});
	return seeding;
}

async function seed(): Promise<void> {
	const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(users);
	if (n > 0) return;

	const accounts: { username: string; role: Role; envKey: string }[] = [
		{ username: 'Rohit.Negi', role: 'admin', envKey: 'SEED_ADMIN_PASSWORD' },
		{ username: 'Siddhesh.Dige', role: 'member', envKey: 'SEED_MEMBER_PASSWORD' }
	];
	for (const a of accounts) {
		const configured = env[a.envKey];
		const password = configured && !validatePassword(configured) ? configured : null;
		const final = password ?? generateTemporaryPassword();
		await db
			.insert(users)
			.values({
				username: a.username,
				usernameLower: normalizeUsername(a.username),
				passwordHash: await hashPassword(final),
				role: a.role,
				mustChangePassword: false,
				createdAt: Date.now()
			})
			.onConflictDoNothing();
		if (!password) {
			console.warn(`[auth] ${a.envKey} not set - generated a password for ${a.username}: ${final}`);
		}
	}
	console.log('[auth] seeded the initial team accounts');
}

// ---------------------------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------------------------

export async function listUsers(): Promise<UserRow[]> {
	const rows = await db.select().from(users).orderBy(asc(users.createdAt), asc(users.id));
	return rows.map(toRow);
}

export async function createUser(input: {
	username: string;
	role: Role;
	/** Omit to have a temporary password generated. */
	password?: string;
}): Promise<{ user: UserRow; temporaryPassword: string }> {
	const nameError = validateUsername(input.username);
	if (nameError) throw new AuthError(400, nameError);
	if (input.role !== 'admin' && input.role !== 'member') throw new AuthError(400, 'Unknown role.');

	const temporaryPassword = input.password?.trim() ? input.password : generateTemporaryPassword();
	const passwordError = validatePassword(temporaryPassword);
	if (passwordError) throw new AuthError(400, passwordError);

	const username = input.username.trim();
	const [row] = await db
		.insert(users)
		.values({
			username,
			usernameLower: normalizeUsername(username),
			passwordHash: await hashPassword(temporaryPassword),
			role: input.role,
			// A password someone else chose is only ever temporary.
			mustChangePassword: true,
			createdAt: Date.now()
		})
		.onConflictDoNothing()
		.returning();
	if (!row) throw new AuthError(409, `A user named "${username}" already exists.`);
	return { user: toRow(row), temporaryPassword };
}

async function adminCount(): Promise<number> {
	const [{ n }] = await db
		.select({ n: sql<number>`count(*)::int` })
		.from(users)
		.where(eq(users.role, 'admin'));
	return n;
}

/** Removes the account and (via cascade) signs it out everywhere, immediately. */
export async function deleteUser(id: number, actingUserId: number): Promise<UserRow> {
	const [target] = await db.select().from(users).where(eq(users.id, id));
	if (!target) throw new AuthError(404, 'No such user.');
	const blocked = removalBlocked({
		targetId: id,
		actingId: actingUserId,
		targetRole: target.role as Role,
		adminCount: await adminCount()
	});
	if (blocked) throw new AuthError(403, blocked);
	await db.delete(users).where(eq(users.id, id));
	return toRow(target);
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
		.where(eq(users.id, id))
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

// Verifying against this when the username doesn't exist keeps response time similar for
// "no such user" and "wrong password", so login can't be used to discover which names exist.
let dummyHash: Promise<string> | null = null;
const getDummyHash = () => (dummyHash ??= hashPassword('not-a-real-password'));

/** Returns the user on success, null on any failure (deliberately indistinguishable). */
export async function authenticate(username: string, password: string): Promise<UserRow | null> {
	const [row] = await db
		.select()
		.from(users)
		.where(eq(users.usernameLower, normalizeUsername(username)));
	const ok = await verifyPassword(password, row?.passwordHash ?? (await getDummyHash()));
	return row && ok ? toRow(row) : null;
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
	if (!row) return null;
	if (row.expiresAt <= Date.now()) {
		await deleteSession(token);
		return null;
	}
	return {
		id: row.user.id,
		username: row.user.username,
		role: row.user.role as Role,
		mustChangePassword: row.user.mustChangePassword
	};
}

export async function deleteSession(token: string): Promise<void> {
	await db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token)));
}
