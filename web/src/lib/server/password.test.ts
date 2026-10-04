import { describe, expect, it } from 'vitest';
import {
	generateTemporaryPassword,
	hashPassword,
	hashToken,
	newSessionToken,
	verifyPassword
} from './password';

describe('password hashing', () => {
	it('verifies the right password and rejects a wrong one', async () => {
		const hash = await hashPassword('correct horse battery');
		expect(await verifyPassword('correct horse battery', hash)).toBe(true);
		expect(await verifyPassword('correct horse batter', hash)).toBe(false);
		expect(await verifyPassword('', hash)).toBe(false);
	});

	it('never stores the password and salts every hash differently', async () => {
		const a = await hashPassword('same-password');
		const b = await hashPassword('same-password');
		expect(a).not.toContain('same-password');
		expect(a).not.toBe(b);
		expect(await verifyPassword('same-password', a)).toBe(true);
		expect(await verifyPassword('same-password', b)).toBe(true);
	});

	it('rejects malformed or foreign stored hashes instead of throwing', async () => {
		for (const bad of ['', 'plain', 'bcrypt$x$y', 'abc$def', 'scrypt$16384$8$1$AAAA$AAAA', '00$00']) {
			expect(await verifyPassword('x', bad), bad).toBe(false);
		}
	});
});

describe('temporary passwords and session tokens', () => {
	it('generates readable, unique temporary passwords that satisfy the policy', () => {
		const seen = new Set<string>();
		for (let i = 0; i < 50; i++) {
			const p = generateTemporaryPassword();
			expect(p).toMatch(/^[A-Za-z0-9]{4}-[A-Za-z0-9]{4}-[A-Za-z0-9]{4}$/);
			expect(p.length).toBeGreaterThanOrEqual(8);
			seen.add(p);
		}
		expect(seen.size).toBe(50);
	});

	it('session tokens are long, unique, and stored only as a digest', () => {
		const t1 = newSessionToken();
		const t2 = newSessionToken();
		expect(t1).not.toBe(t2);
		expect(t1.length).toBeGreaterThanOrEqual(43);
		const digest = hashToken(t1);
		expect(digest).toMatch(/^[0-9a-f]{64}$/);
		expect(digest).not.toContain(t1);
		expect(hashToken(t1)).toBe(digest);
	});
});

describe('compatibility with existing accounts', () => {
	it('verifies a hash written by the original Python backend', async () => {
		// hashlib.pbkdf2_hmac('sha256', b'secret-pass', bytes.fromhex(salt), 260000, 32)
		const { pbkdf2Sync } = await import('node:crypto');
		const salt = '00112233445566778899aabbccddeeff';
		const digest = pbkdf2Sync('secret-pass', Buffer.from(salt, 'hex'), 260_000, 32, 'sha256');
		const stored = `${salt}$${digest.toString('hex')}`;
		expect(await verifyPassword('secret-pass', stored)).toBe(true);
		expect(await verifyPassword('secret-pas', stored)).toBe(false);
	});
});
