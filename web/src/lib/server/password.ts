import { randomBytes, scrypt as scryptCb, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';

// No third-party dependency: Node's built-in scrypt (a memory-hard KDF) with a per-password
// random salt. Stored as `scrypt$N$r$p$<salt b64>$<hash b64>` so parameters can be raised later
// without invalidating existing hashes.

const scrypt = promisify(scryptCb) as (
	password: string,
	salt: Buffer,
	keylen: number
) => Promise<Buffer>;

const N = 16384;
const KEY_LEN = 64;

export async function hashPassword(password: string): Promise<string> {
	const salt = randomBytes(16);
	const hash = await scrypt(password, salt, KEY_LEN);
	return `scrypt$${N}$8$1$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
	const [scheme, n, r, p, saltB64, hashB64] = stored.split('$');
	if (scheme !== 'scrypt' || Number(n) !== N || Number(r) !== 8 || Number(p) !== 1) return false;
	if (!saltB64 || !hashB64) return false;
	const expected = Buffer.from(hashB64, 'base64');
	const actual = await scrypt(password, Buffer.from(saltB64, 'base64'), expected.length);
	return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/** A readable temporary password (no look-alike characters) for new/reset accounts. */
export function generateTemporaryPassword(): string {
	const alphabet = 'abcdefghjkmnpqrstuvwxyzACDEFGHJKLMNPQRTUVWXYZ23456789';
	const bytes = randomBytes(12);
	let out = '';
	for (const b of bytes) out += alphabet[b % alphabet.length];
	return `${out.slice(0, 4)}-${out.slice(4, 8)}-${out.slice(8, 12)}`;
}

/** Session tokens are random and high-entropy, so a fast hash is the right tool: the database
 *  only ever holds this digest, never the cookie value itself. */
export function hashToken(token: string): string {
	return createHash('sha256').update(token).digest('hex');
}

export function newSessionToken(): string {
	return randomBytes(32).toString('base64url');
}
