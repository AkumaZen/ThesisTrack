// Ports app/auth.py + app/services/user_auth.py's hashing/token pieces.
// PBKDF2-HMAC-SHA256, 260k iterations, "saltHex$digestHex" format - byte-for-
// byte compatible with the existing Python-generated hashes in the DB, so no
// forced password reset for the 3 seeded users.
import { pbkdf2Sync, randomBytes, timingSafeEqual } from 'node:crypto';
import { SignJWT, jwtVerify, errors as joseErrors } from 'jose';
import { env } from '$env/dynamic/private';
import { db } from './db';
import { users } from './db/schema';
import { eq } from 'drizzle-orm';

const PBKDF2_ITERATIONS = 260_000;
const JWT_SECRET = new TextEncoder().encode(env.JWT_SECRET ?? 'dev-only-insecure-secret-change-me');
const JWT_ALGORITHM = 'HS256';
const JWT_EXPIRY_HOURS = 24;
const API_KEY = env.API_KEY ?? 'dev-key';
const ANALYST_NAME = env.ANALYST_NAME ?? 'analyst';

export function hashPassword(password: string, saltHex?: string): string {
	const salt = saltHex ? Buffer.from(saltHex, 'hex') : randomBytes(16);
	const digest = pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, 32, 'sha256');
	return `${salt.toString('hex')}$${digest.toString('hex')}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
	const parts = storedHash.split('$');
	if (parts.length !== 2) return false;
	const [saltHex] = parts;
	const candidate = hashPassword(password, saltHex);
	const a = Buffer.from(candidate);
	const b = Buffer.from(storedHash);
	return a.length === b.length && timingSafeEqual(a, b);
}

export async function issueToken(email: string, role: string): Promise<string> {
	return new SignJWT({ role })
		.setProtectedHeader({ alg: JWT_ALGORITHM })
		.setSubject(email)
		.setExpirationTime(`${JWT_EXPIRY_HOURS}h`)
		.sign(JWT_SECRET);
}

export interface Actor {
	identity: string;
	role: string;
	source: 'user' | 'api_key';
}

export class AuthError extends Error {
	status: number;
	constructor(message: string, status = 401) {
		super(message);
		this.status = status;
	}
}

export async function resolveActor(headers: Headers): Promise<Actor> {
	const authorization = headers.get('authorization');
	if (authorization?.toLowerCase().startsWith('bearer ')) {
		const token = authorization.slice(7);
		try {
			const { payload } = await jwtVerify(token, JWT_SECRET, { algorithms: [JWT_ALGORITHM] });
			return {
				identity: payload.sub as string,
				role: (payload.role as string) ?? 'read_write',
				source: 'user'
			};
		} catch (err) {
			if (err instanceof joseErrors.JOSEError) {
				throw new AuthError('invalid or expired token', 401);
			}
			throw err;
		}
	}

	const apiKey = headers.get('x-api-key');
	if (apiKey === API_KEY) {
		return { identity: ANALYST_NAME, role: 'read_write', source: 'api_key' };
	}

	throw new AuthError('provide a valid X-API-Key or Authorization: Bearer <token>', 401);
}

export function requireWrite(actor: Actor): Actor {
	if (actor.role !== 'read_write') {
		throw new AuthError('read-only users cannot perform this action', 403);
	}
	return actor;
}

export async function authenticate(email: string, password: string) {
	const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
	if (!user || !user.isActive || !verifyPassword(password, user.passwordHash)) {
		throw new AuthError('invalid email or password', 401);
	}
	await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));
	return user;
}

export async function changePassword(email: string, oldPassword: string, newPassword: string) {
	const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
	if (!user) throw new AuthError(`user '${email}' not found`, 401);
	if (!verifyPassword(oldPassword, user.passwordHash)) {
		throw new AuthError('current password is incorrect', 401);
	}
	await db.update(users).set({ passwordHash: hashPassword(newPassword) }).where(eq(users.id, user.id));
}
