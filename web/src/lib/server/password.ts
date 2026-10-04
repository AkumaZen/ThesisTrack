import { createHash, pbkdf2 as pbkdf2Cb, randomBytes, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

// PBKDF2-HMAC-SHA256, 260k iterations, stored as "saltHex$digestHex" - byte-for-byte the format
// the original Python backend wrote, so every existing account keeps working. Async so a login
// never blocks the event loop for the ~100ms the derivation takes.

const pbkdf2 = promisify(pbkdf2Cb);
const ITERATIONS = 260_000;
const KEY_LEN = 32;

async function derive(password: string, salt: Buffer): Promise<Buffer> {
	return pbkdf2(password, salt, ITERATIONS, KEY_LEN, 'sha256');
}

export async function hashPassword(password: string): Promise<string> {
	const salt = randomBytes(16);
	return `${salt.toString('hex')}$${(await derive(password, salt)).toString('hex')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
	const parts = stored.split('$');
	if (parts.length !== 2) return false;
	const [saltHex, digestHex] = parts;
	if (!/^[0-9a-f]{32}$/.test(saltHex) || !/^[0-9a-f]{64}$/.test(digestHex)) return false;
	const expected = Buffer.from(digestHex, 'hex');
	const actual = await derive(password, Buffer.from(saltHex, 'hex'));
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
