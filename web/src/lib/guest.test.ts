import { describe, expect, it } from 'vitest';
import {
	GUEST_USER,
	LOCKED_FEATURES,
	guestMayCallApi,
	guestMayOpenPage,
	guestPageRedirect,
	guestShowcaseTarget,
	isGuest,
	lockedFeatureByKey,
	lockedFeatureForPath
} from './guest';

describe('guest identity', () => {
	it('is a stand-in user that matches no real account', () => {
		expect(GUEST_USER.id).toBe(0);
		expect(isGuest(GUEST_USER)).toBe(true);
		expect(isGuest({ role: 'read_only' })).toBe(false);
		expect(isGuest(null)).toBe(false);
		expect(isGuest(undefined)).toBe(false);
	});
});

describe('locked features', () => {
	it('have unique keys and are found by key and by page', () => {
		const keys = LOCKED_FEATURES.map((f) => f.key);
		expect(new Set(keys).size).toBe(keys.length);
		expect(lockedFeatureByKey('alerts')?.title).toMatch(/Alerts/);
		expect(lockedFeatureByKey('nope')).toBeUndefined();
		expect(lockedFeatureForPath('/valuation/alerts')?.key).toBe('alerts');
		expect(lockedFeatureForPath('/valuation/price-alerts/x')?.key).toBe('alerts');
		expect(lockedFeatureForPath('/valuation/master-tracker/TCS')?.key).toBe('master-tracker');
		expect(lockedFeatureForPath('/scorecard')?.key).toBe('team-review');
	});

	it('match whole path segments only', () => {
		expect(lockedFeatureForPath('/valuation/alertsx')).toBeUndefined();
		expect(lockedFeatureForPath('/reviewer')).toBeUndefined();
		expect(lockedFeatureForPath('/valuation/alerts/../company')).toBeUndefined();
	});

	it('never overlap the pages a guest may open', () => {
		for (const f of LOCKED_FEATURES) {
			for (const p of f.pages) expect(guestMayOpenPage(p), p).toBe(false);
		}
	});
});

describe('guestMayOpenPage', () => {
	it('opens the home pages exactly and the read-only tools by prefix', () => {
		expect(guestMayOpenPage('/')).toBe(true);
		expect(guestMayOpenPage('/valuation')).toBe(true);
		expect(guestMayOpenPage('/valuation/company/TCS')).toBe(true);
		expect(guestMayOpenPage('/company/ABC')).toBe(true);
		expect(guestMayOpenPage('/locked/alerts')).toBe(true);
	});

	it('does not open anything else', () => {
		for (const p of ['/admin/users', '/valuation/lists', '/valuation/sectors', '/account/password', '/valuation/companyx', '/company/../admin']) {
			expect(guestMayOpenPage(p), p).toBe(false);
		}
	});
});

describe('guestMayCallApi', () => {
	it('allows reads of the allowlisted areas', () => {
		for (const p of [
			'/api/auth/me',
			'/api/companies',
			'/api/companies/X/thesis',
			'/api/valuation/valuations',
			'/api/valuation/valuations/TCS/history',
			'/api/valuation/company/TCS',
			'/api/valuation/company/TCS/price-chart',
			'/api/valuation/compare'
		]) {
			expect(guestMayCallApi(p, 'GET'), p).toBe(true);
			expect(guestMayCallApi(p, 'HEAD'), p).toBe(true);
		}
	});

	it('refuses every write', () => {
		for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
			expect(guestMayCallApi('/api/companies', method), method).toBe(false);
		}
	});

	it('refuses personal, admin and data-loading endpoints', () => {
		for (const p of [
			'/api/admin/showcase',
			'/api/tables/1',
			'/api/notes/1',
			'/api/valuation/me/prefs',
			'/api/valuation/alerts',
			'/api/valuation/valuations/removed',
			'/api/valuation/strength/prefs',
			'/api/valuation/search/all',
			'/api/valuation/search',
			'/api/valuation/company/TCS/depth',
			'/api/valuation/company/TCS/refresh-price',
			'/api/valuation/company/TCS/refresh-series',
			'/api/valuation/company/TCS/status',
			'/api/valuation/company/TCS/coverage',
			'/api/companiesx',
			'/api/companies/../admin/users'
		]) {
			expect(guestMayCallApi(p, 'GET'), p).toBe(false);
		}
	});
});

describe('guestPageRedirect', () => {
	it('sends locked pages to their preview, open pages nowhere, the rest to sign in', () => {
		expect(guestPageRedirect('/valuation/alerts')).toBe('/locked/alerts');
		expect(guestPageRedirect('/valuation/company/TCS')).toBeNull();
		expect(guestPageRedirect('/admin/users', '?tab=1')).toBe('/login?next=%2Fadmin%2Fusers%3Ftab%3D1');
	});
});

describe('guestShowcaseTarget', () => {
	it('finds the company or symbol a read is about', () => {
		expect(guestShowcaseTarget('/api/companies/BALU_FORGE')).toEqual({ kind: 'company', id: 'BALU_FORGE' });
		expect(guestShowcaseTarget('/api/companies/A%20B/thesis')).toEqual({ kind: 'company', id: 'A B' });
		expect(guestShowcaseTarget('/api/valuation/valuations/tcs')).toEqual({ kind: 'symbol', symbol: 'TCS' });
		expect(guestShowcaseTarget('/api/valuation/valuations/TCS/history/3')).toEqual({ kind: 'symbol', symbol: 'TCS' });
		expect(guestShowcaseTarget('/api/valuation/company/hfcl/team')).toEqual({ kind: 'symbol', symbol: 'HFCL' });
		expect(guestShowcaseTarget('/api/valuation/company/HFCL/notes')).toEqual({ kind: 'symbol', symbol: 'HFCL' });
	});

	it('leaves lists and market data alone', () => {
		expect(guestShowcaseTarget('/api/companies')).toBeNull();
		expect(guestShowcaseTarget('/api/valuation/valuations')).toBeNull();
		expect(guestShowcaseTarget('/api/valuation/company/TCS')).toBeNull();
		expect(guestShowcaseTarget('/api/valuation/company/TCS/price-chart')).toBeNull();
	});

	it('turns a malformed escape into a target that is never showcased', () => {
		expect(guestShowcaseTarget('/api/companies/%E0%A4%A')).toEqual({ kind: 'company', id: '' });
	});
});
