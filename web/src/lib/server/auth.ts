// Who is making a request. A signed-in browser is identified by its session cookie (resolved in
// hooks.server.ts, see accounts.ts); scripts and the LLM import pipeline can instead send a
// Bearer JWT or the shared X-API-Key. Thesis routes only ever see the resulting Actor.
import { SignJWT, jwtVerify, errors as joseErrors } from 'jose';
import { env } from '$env/dynamic/private';
import { canWrite, type SessionUser } from '$lib/auth';

const JWT_SECRET = new TextEncoder().encode(env.JWT_SECRET ?? 'dev-only-insecure-secret-change-me');
const JWT_ALGORITHM = 'HS256';
const JWT_EXPIRY_HOURS = 24;
const API_KEY = env.API_KEY ?? 'dev-key';
const ANALYST_NAME = env.ANALYST_NAME ?? 'analyst';

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

/** True when the request carries a script credential (whether or not it is valid). */
export function hasApiCredential(headers: Headers): boolean {
	return Boolean(headers.get('x-api-key') || headers.get('authorization')?.toLowerCase().startsWith('bearer '));
}

export async function resolveActor(headers: Headers, user: SessionUser | null = null): Promise<Actor> {
	if (user) return { identity: user.email, role: user.role, source: 'user' };

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

	throw new AuthError('sign in, or provide a valid X-API-Key or Authorization: Bearer <token>', 401);
}

export function requireWrite(actor: Actor): Actor {
	if (!canWrite(actor.role as SessionUser['role'])) {
		throw new AuthError('read-only users cannot perform this action', 403);
	}
	return actor;
}
