import { describe, expect, it } from 'vitest';
import { decideAccess } from './access';
import {
	safeNextPath,
	validatePassword,
	validateUsername,
	normalizeUsername,
	removalBlocked,
	type SessionUser
} from './auth';

const admin: SessionUser = {
	id: 1,
	username: 'Rohit.Negi',
	role: 'admin',
	mustChangePassword: false
};
const member: SessionUser = {
	id: 2,
	username: 'Siddhesh.Dige',
	role: 'member',
	mustChangePassword: false
};
const fresh: SessionUser = { ...member, mustChangePassword: true };

const d = (pathname: string, method = 'GET', user: SessionUser | null = null) =>
	decideAccess({ pathname, method, user });

describe('decideAccess: signed out', () => {
	it('only the login, logout and health-check paths are public', () => {
		expect(d('/login')).toBe('allow');
		expect(d('/logout', 'POST')).toBe('allow');
		expect(d('/healthz')).toBe('allow');
		expect(d('/healthzz')).toBe('login');
	});

	it('everything else - pages and APIs - requires login', () => {
		for (const p of [
			'/',
			'/company/TCS',
			'/alerts',
			'/sectors',
			'/api/valuations',
			'/api/alerts'
		]) {
			expect(d(p), p).toBe('login');
		}
		expect(d('/api/valuations/TCS', 'PUT')).toBe('login');
		// A path that merely starts with the public one is NOT public.
		expect(d('/login-evil')).toBe('login');
		expect(d('/logout/../admin/users')).toBe('login');
	});
});

describe('decideAccess: member', () => {
	it('can use the shared app', () => {
		for (const p of ['/', '/company/TCS', '/alerts', '/sector-rotation', '/api/valuations/TCS']) {
			expect(d(p, 'GET', member), p).toBe('allow');
		}
		expect(d('/api/valuations/TCS', 'PUT', member)).toBe('allow');
		expect(d('/api/alerts/read', 'POST', member)).toBe('allow');
		expect(d('/api/alerts/settings', 'PUT', member)).toBe('allow');
	});

	it('cannot open admin pages or call admin APIs', () => {
		expect(d('/admin/users', 'GET', member)).toBe('forbidden');
		expect(d('/sectors', 'GET', member)).toBe('forbidden');
		expect(d('/api/admin/users', 'GET', member)).toBe('forbidden');
		expect(d('/api/admin/users', 'POST', member)).toBe('forbidden');
		expect(d('/api/admin/users/3', 'DELETE', member)).toBe('forbidden');
	});

	it('can read the sector taxonomy but not change it', () => {
		expect(d('/api/sectors', 'GET', member)).toBe('allow');
		for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
			expect(d('/api/sectors/baskets', method, member), method).toBe('forbidden');
			expect(d('/api/sectors/majors/x', method, member), method).toBe('forbidden');
			expect(d('/api/sector-rotation-import', method, member), method).toBe('forbidden');
		}
		expect(d('/api/sectors/verify', 'POST', member)).toBe('forbidden');
	});

	it('must change a temporary password before anything else', () => {
		expect(d('/', 'GET', fresh)).toBe('change-password');
		expect(d('/api/valuations', 'GET', fresh)).toBe('change-password');
		expect(d('/account/password', 'GET', fresh)).toBe('allow');
		expect(d('/api/account/password', 'POST', fresh)).toBe('allow');
		expect(d('/logout', 'POST', fresh)).toBe('allow');
	});
});

describe('decideAccess: admin', () => {
	it('can open everything', () => {
		for (const p of ['/admin/users', '/sectors', '/api/admin/users', '/api/sectors/baskets']) {
			for (const method of ['GET', 'POST', 'DELETE']) {
				expect(d(p, method, admin), `${method} ${p}`).toBe('allow');
			}
		}
	});
});

describe('auth validation helpers', () => {
	it('matches usernames case-insensitively', () => {
		expect(normalizeUsername('  Rohit.NEGI ')).toBe('rohit.negi');
	});

	it('accepts the two real usernames and rejects junk', () => {
		expect(validateUsername('Rohit.Negi')).toBeNull();
		expect(validateUsername('Siddhesh.Dige')).toBeNull();
		for (const bad of ['', ' ', 'a', '1abc', 'has space', 'x'.repeat(33), 'a<b>', null, 42]) {
			expect(validateUsername(bad), String(bad)).not.toBeNull();
		}
	});

	it('enforces a minimum password length', () => {
		expect(validatePassword('1234567')).not.toBeNull();
		expect(validatePassword('12345678')).toBeNull();
		expect(validatePassword('x'.repeat(129))).not.toBeNull();
		expect(validatePassword(undefined)).not.toBeNull();
	});

	it('only ever redirects to same-site relative paths after login', () => {
		expect(safeNextPath('/company/TCS?x=1')).toBe('/company/TCS?x=1');
		for (const evil of [
			'https://evil.com',
			'//evil.com',
			'/\\evil.com',
			'javascript:alert(1)',
			'company',
			'',
			null,
			undefined,
			'/login',
			'/logout'
		]) {
			expect(safeNextPath(evil as string | null | undefined), String(evil)).toBe('/');
		}
	});
});

describe('removalBlocked', () => {
	it('blocks removing yourself, even as the only admin', () => {
		expect(
			removalBlocked({ targetId: 1, actingId: 1, targetRole: 'admin', adminCount: 2 })
		).toMatch(/own account/);
		expect(
			removalBlocked({ targetId: 1, actingId: 1, targetRole: 'admin', adminCount: 1 })
		).toMatch(/own account/);
	});

	it('blocks removing the last admin', () => {
		expect(
			removalBlocked({ targetId: 2, actingId: 1, targetRole: 'admin', adminCount: 1 })
		).toMatch(/last admin/);
	});

	it('allows removing a member, or one of several admins', () => {
		expect(
			removalBlocked({ targetId: 3, actingId: 1, targetRole: 'member', adminCount: 1 })
		).toBeNull();
		expect(
			removalBlocked({ targetId: 2, actingId: 1, targetRole: 'admin', adminCount: 2 })
		).toBeNull();
	});
});
