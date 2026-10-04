import { describe, expect, it } from 'vitest';
import { decideAccess } from './access';
import {
	safeNextPath,
	validatePassword,
	validateDisplayName,
	validateEmail,
	normalizeEmail,
	displayNameFromEmail,
	removalBlocked,
	canWrite,
	type SessionUser
} from './auth';

const admin: SessionUser = {
	id: 1,
	email: 'rohit.negi@rdc.in',
	username: 'Rohit.Negi',
	role: 'admin',
	mustChangePassword: false
};
const member: SessionUser = {
	id: 2,
	email: 'siddhesh.dige@rdc.in',
	username: 'Siddhesh.Dige',
	role: 'read_write',
	mustChangePassword: false
};
const viewer: SessionUser = { ...member, id: 3, role: 'read_only' };
const fresh: SessionUser = { ...member, mustChangePassword: true };

const d = (pathname: string, method = 'GET', user: SessionUser | null = null) =>
	decideAccess({ pathname, method, user });
const withKey = (pathname: string, method = 'GET') =>
	decideAccess({ pathname, method, user: null, hasApiCredential: true });

describe('decideAccess: signed out', () => {
	it('only the login, logout, health-check and cron paths are public', () => {
		expect(d('/login')).toBe('allow');
		expect(d('/logout', 'POST')).toBe('allow');
		expect(d('/api/auth/login', 'POST')).toBe('allow');
		expect(d('/api/health')).toBe('allow');
		expect(d('/api/cron/alerts')).toBe('allow');
		expect(d('/api/healthz')).toBe('login');
	});

	it('everything else - pages and APIs - requires login', () => {
		for (const p of [
			'/',
			'/company/X',
			'/valuation',
			'/valuation/company/TCS',
			'/valuation/alerts',
			'/valuation/sectors',
			'/api/companies',
			'/api/valuation/valuations',
			'/api/valuation/alerts'
		]) {
			expect(d(p), p).toBe('login');
		}
		expect(d('/api/valuation/valuations/TCS', 'PUT')).toBe('login');
		// A path that merely starts with the public one is NOT public.
		expect(d('/login-evil')).toBe('login');
		expect(d('/logout/../admin/users')).toBe('login');
	});

	it('scripts with an API key reach the thesis APIs, never the session-only ones', () => {
		expect(withKey('/api/companies')).toBe('allow');
		expect(withKey('/api/companies/X/thesis', 'PUT')).toBe('allow');
		expect(withKey('/api/valuation/valuations')).toBe('login');
		expect(withKey('/api/admin/users')).toBe('login');
		expect(withKey('/api/account/password', 'POST')).toBe('login');
		expect(withKey('/review')).toBe('login');
	});
});

describe('decideAccess: analyst', () => {
	it('can use the shared app', () => {
		for (const p of [
			'/',
			'/valuation',
			'/valuation/company/TCS',
			'/valuation/alerts',
			'/valuation/sector-rotation',
			'/api/valuation/valuations/TCS'
		]) {
			expect(d(p, 'GET', member), p).toBe('allow');
		}
		expect(d('/api/valuation/valuations/TCS', 'PUT', member)).toBe('allow');
		expect(d('/api/valuation/alerts/read', 'POST', member)).toBe('allow');
		expect(d('/api/valuation/alerts/settings', 'PUT', member)).toBe('allow');
		// The thesis sector groupings are an analyst tool, not admin configuration.
		expect(d('/sectors', 'GET', member)).toBe('allow');
		expect(d('/api/sectors', 'POST', member)).toBe('allow');
	});

	it('cannot open admin pages or call admin APIs', () => {
		expect(d('/admin/users', 'GET', member)).toBe('forbidden');
		expect(d('/valuation/sectors', 'GET', member)).toBe('forbidden');
		expect(d('/api/admin/users', 'GET', member)).toBe('forbidden');
		expect(d('/api/admin/users', 'POST', member)).toBe('forbidden');
		expect(d('/api/admin/users/3', 'DELETE', member)).toBe('forbidden');
	});

	it('can read the valuation sector taxonomy but not change it', () => {
		expect(d('/api/valuation/sectors', 'GET', member)).toBe('allow');
		for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
			expect(d('/api/valuation/sectors/baskets', method, member), method).toBe('forbidden');
			expect(d('/api/valuation/sectors/majors/x', method, member), method).toBe('forbidden');
			expect(d('/api/valuation/sector-rotation-import', method, member), method).toBe(
				'forbidden'
			);
		}
		expect(d('/api/valuation/sectors/verify', 'POST', member)).toBe('forbidden');
	});

	it('must change a temporary password before anything else', () => {
		expect(d('/', 'GET', fresh)).toBe('change-password');
		expect(d('/api/valuation/valuations', 'GET', fresh)).toBe('change-password');
		expect(d('/api/companies', 'GET', fresh)).toBe('change-password');
		expect(d('/account/password', 'GET', fresh)).toBe('allow');
		expect(d('/api/account/password', 'POST', fresh)).toBe('allow');
		expect(d('/logout', 'POST', fresh)).toBe('allow');
	});
});

describe('decideAccess: read only', () => {
	it('can look at the valuation tools but not change them', () => {
		expect(d('/valuation/company/TCS', 'GET', viewer)).toBe('allow');
		expect(d('/api/valuation/valuations/TCS', 'GET', viewer)).toBe('allow');
		expect(d('/api/valuation/valuations/TCS', 'PUT', viewer)).toBe('forbidden');
		expect(d('/api/valuation/company/TCS/notes', 'POST', viewer)).toBe('forbidden');
		expect(canWrite('read_only')).toBe(false);
		expect(canWrite('read_write')).toBe(true);
		expect(canWrite('admin')).toBe(true);
	});

	it('can keep their own display preferences and remembered filters', () => {
		expect(d('/api/valuation/me/prefs', 'PUT', viewer)).toBe('allow');
		expect(d('/api/valuation/me/reset', 'POST', viewer)).toBe('allow');
		expect(d('/api/valuation/me/visit', 'POST', viewer)).toBe('allow');
		expect(d('/api/valuation/strength/prefs', 'PUT', viewer)).toBe('allow');
		// ...but not the team's alert rules next to them.
		expect(d('/api/valuation/strength/rules', 'POST', viewer)).toBe('forbidden');
		expect(d('/api/valuation/strength', 'POST', viewer)).toBe('forbidden');
	});
});

describe('decideAccess: admin', () => {
	it('can open everything', () => {
		for (const p of [
			'/admin/users',
			'/valuation/sectors',
			'/api/admin/users',
			'/api/valuation/sectors/baskets'
		]) {
			for (const method of ['GET', 'POST', 'DELETE']) {
				expect(d(p, method, admin), `${method} ${p}`).toBe('allow');
			}
		}
	});
});

describe('auth validation helpers', () => {
	it('matches emails case-insensitively and derives display names from them', () => {
		expect(normalizeEmail('  Rohit.NEGI@rdc.in ')).toBe('rohit.negi@rdc.in');
		expect(displayNameFromEmail('rohit.negi@rdc.in')).toBe('Rohit.Negi');
		expect(displayNameFromEmail('Siddhesh.Dige@RDC.in')).toBe('Siddhesh.Dige');
	});

	it('accepts real emails and display names and rejects junk', () => {
		expect(validateEmail('rohit.negi@rdc.in')).toBeNull();
		for (const bad of ['', ' ', 'rohit', 'a@b', 'a b@c.d', null, 42]) {
			expect(validateEmail(bad), String(bad)).not.toBeNull();
		}
		expect(validateDisplayName('Rohit.Negi')).toBeNull();
		for (const bad of ['', ' ', 'a', '1abc', 'x'.repeat(41), 'a<b>', null, 42]) {
			expect(validateDisplayName(bad), String(bad)).not.toBeNull();
		}
	});

	it('enforces a minimum password length', () => {
		expect(validatePassword('1234567')).not.toBeNull();
		expect(validatePassword('12345678')).toBeNull();
		expect(validatePassword('x'.repeat(129))).not.toBeNull();
		expect(validatePassword(undefined)).not.toBeNull();
	});

	it('only ever redirects to same-site relative paths after login', () => {
		expect(safeNextPath('/valuation/company/TCS?x=1')).toBe('/valuation/company/TCS?x=1');
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

	it('allows removing an analyst, or one of several admins', () => {
		expect(
			removalBlocked({ targetId: 3, actingId: 1, targetRole: 'read_write', adminCount: 1 })
		).toBeNull();
		expect(
			removalBlocked({ targetId: 2, actingId: 1, targetRole: 'admin', adminCount: 2 })
		).toBeNull();
	});
});
