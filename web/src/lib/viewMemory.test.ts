import { describe, expect, it } from 'vitest';
import {
	clearSessionState,
	defaultsOf,
	loadView,
	readOrigin,
	readVisit,
	rememberOrigin,
	rememberVisit,
	resetAll,
	resetView,
	saveView,
	type StorageLike,
	type Stores
} from './viewMemory';

class MemoryStorage implements StorageLike {
	map = new Map<string, string>();
	get length() {
		return this.map.size;
	}
	key(i: number) {
		return [...this.map.keys()][i] ?? null;
	}
	getItem(k: string) {
		return this.map.get(k) ?? null;
	}
	setItem(k: string, v: string) {
		this.map.set(k, v);
	}
	removeItem(k: string) {
		this.map.delete(k);
	}
}
const fresh = (): Stores & { session: MemoryStorage; local: MemoryStorage } => ({
	session: new MemoryStorage(),
	local: new MemoryStorage()
});

describe('loadView', () => {
	it('starts from the defaults when nothing is saved', () => {
		expect(loadView('sector', 1, '', undefined, fresh())).toEqual(defaultsOf('sector'));
	});

	it('restores this tab state and the lasting preferences', () => {
		const s = fresh();
		saveView('sector', 1, '', { sort: 'return3m', dir: 'asc', strength: 'open', importer: true, scrollY: 420 }, s);
		expect(loadView('sector', 1, '', undefined, s)).toEqual({
			sort: 'return3m',
			dir: 'asc',
			strength: 'open',
			importer: true,
			scrollY: 420
		});
	});

	it('keeps only display preferences across sessions, not panels or scroll', () => {
		const s = fresh();
		saveView('sector', 1, '', { sort: 'return1w', dir: 'asc', strength: 'open', scrollY: 900 }, s);
		s.session.map.clear(); // a new tab
		expect(loadView('sector', 1, '', undefined, s)).toEqual({
			...defaultsOf('sector'),
			sort: 'return1w',
			dir: 'asc'
		});
	});

	it('lets an explicit URL parameter beat anything saved', () => {
		const s = fresh();
		saveView('sector', 1, '', { sort: 'return3m', dir: 'asc' }, s);
		const state = loadView('sector', 1, '', new URLSearchParams('sort=return6m'), s);
		expect(state.sort).toBe('return6m');
		expect(state.dir).toBe('asc');
	});

	it('ignores an invalid URL parameter and falls back to the saved value', () => {
		const s = fresh();
		saveView('sector', 1, '', { sort: 'return3m' }, s);
		expect(loadView('sector', 1, '', new URLSearchParams('sort=banana'), s).sort).toBe('return3m');
	});

	it('keeps views and scopes apart', () => {
		const s = fresh();
		saveView('sector', 1, 'it', { sort: 'label', scrollY: 50 }, s);
		expect(loadView('sector', 1, 'banks', undefined, s).scrollY).toBe(0);
		expect(loadView('sector', 1, 'it', undefined, s).scrollY).toBe(50);
		expect(loadView('subsector', 1, 'it', undefined, s)).toEqual(defaultsOf('subsector'));
	});

	it('never hands one person the settings of another', () => {
		const s = fresh();
		saveView('sector', 1, '', { sort: 'label', dir: 'asc', scrollY: 77 }, s);
		expect(loadView('sector', 2, '', undefined, s)).toEqual(defaultsOf('sector'));
	});

	it('does nothing without a signed-in person', () => {
		const s = fresh();
		saveView('sector', undefined, '', { sort: 'label' }, s);
		expect(s.local.length + s.session.length).toBe(0);
		expect(loadView('sector', null, '', undefined, s)).toEqual(defaultsOf('sector'));
	});

	it('drops bad fields one by one and keeps the good ones', () => {
		const s = fresh();
		s.session.setItem(
			'tt:v1:1:sector::s',
			JSON.stringify({ v: 1, s: { sort: 'nonsense', dir: 'asc', strength: 'bogus', importer: 'yes', scrollY: -5 } })
		);
		expect(loadView('sector', 1, '', undefined, s)).toEqual({
			...defaultsOf('sector'),
			dir: 'asc'
		});
	});

	it('discards an entry saved in another version', () => {
		const s = fresh();
		s.session.setItem('tt:v1:1:sector::s', JSON.stringify({ v: 0, s: { sort: 'label' } }));
		s.local.setItem('tt:v1:1:sector:l', JSON.stringify({ v: 2, s: { sort: 'label' } }));
		expect(loadView('sector', 1, '', undefined, s)).toEqual(defaultsOf('sector'));
	});

	it('survives unreadable storage content', () => {
		const s = fresh();
		s.session.setItem('tt:v1:1:sector::s', '{not json');
		s.local.setItem('tt:v1:1:sector:l', '[1,2]');
		expect(loadView('sector', 1, '', undefined, s)).toEqual(defaultsOf('sector'));
		expect(s.session.getItem('tt:v1:1:sector::s')).toBeNull(); // cleaned up
	});

	it('survives storage that throws', () => {
		const boom: StorageLike = {
			length: 0,
			key: () => null,
			getItem: () => {
				throw new Error('blocked');
			},
			setItem: () => {
				throw new Error('blocked');
			},
			removeItem: () => {
				throw new Error('blocked');
			}
		};
		const stores = { session: boom, local: boom };
		expect(() => saveView('sector', 1, '', { sort: 'label' }, stores)).not.toThrow();
		expect(loadView('sector', 1, '', undefined, stores)).toEqual(defaultsOf('sector'));
		expect(() => resetAll(1, stores)).not.toThrow();
	});

	it('works with no storage at all', () => {
		const none = { session: null, local: null };
		saveView('company', 1, 'TCS', { chartRange: '6M' }, none);
		expect(loadView('company', 1, 'TCS', undefined, none)).toEqual(defaultsOf('company'));
	});
});

describe('resets', () => {
	it('resetView returns one view to its defaults and leaves the others alone', () => {
		const s = fresh();
		saveView('sector', 1, '', { sort: 'label', scrollY: 10 }, s);
		saveView('subsector', 1, 'x', { timeframe: '1W' }, s);
		resetView('sector', 1, '', s);
		expect(loadView('sector', 1, '', undefined, s)).toEqual(defaultsOf('sector'));
		expect(loadView('subsector', 1, 'x', undefined, s).timeframe).toBe('1W');
	});

	it('resetAll clears everything for that person only', () => {
		const s = fresh();
		saveView('sector', 1, '', { sort: 'label' }, s);
		saveView('company', 1, 'TCS', { chartRange: '3M' }, s);
		rememberVisit(1, { path: '/valuation/sector-rotation', label: 'Sector rotation' }, s);
		saveView('sector', 2, '', { sort: 'return1w' }, s);
		resetAll(1, s);
		expect(loadView('sector', 1, '', undefined, s)).toEqual(defaultsOf('sector'));
		expect(loadView('company', 1, 'TCS', undefined, s)).toEqual(defaultsOf('company'));
		expect(readVisit(1, s)).toBeNull();
		expect(loadView('sector', 2, '', undefined, s).sort).toBe('return1w');
	});

	it('clearSessionState removes temporary state for everyone but keeps lasting preferences', () => {
		const s = fresh();
		saveView('sector', 1, '', { sort: 'label', scrollY: 99 }, s);
		saveView('sector', 2, '', { sort: 'return1w', scrollY: 55 }, s);
		clearSessionState(s);
		expect(s.session.length).toBe(0);
		expect(loadView('sector', 1, '', undefined, s)).toEqual({ ...defaultsOf('sector'), sort: 'label' });
	});
});

describe('last visited context', () => {
	const path = '/valuation/sector-rotation/it/it_services';
	it('round trips a valid place', () => {
		const s = fresh();
		rememberVisit(1, { path, label: 'IT Services' }, s);
		expect(readVisit(1, s)).toEqual({ path, label: 'IT Services' });
		expect(readVisit(2, s)).toBeNull();
	});

	it('refuses paths outside the valuation views', () => {
		const s = fresh();
		rememberVisit(1, { path: 'https://evil.example/x', label: 'x' }, s);
		rememberVisit(1, { path: '/admin/users', label: 'Team' }, s);
		expect(readVisit(1, s)).toBeNull();
	});

	it('discards a visit older than 90 days', () => {
		const s = fresh();
		const then = Date.now() - 91 * 24 * 3600 * 1000;
		rememberVisit(1, { path, label: 'IT Services' }, s, then);
		expect(readVisit(1, s)).toBeNull();
		expect(s.local.length).toBe(0);
	});

	it('discards a tampered entry', () => {
		const s = fresh();
		s.local.setItem('tt:v1:1:last', JSON.stringify({ v: 1, path: '//evil.example', label: 'x', at: Date.now() }));
		expect(readVisit(1, s)).toBeNull();
	});
});

describe('where a company was opened from', () => {
	it('remembers the list, with its sort, per company and per person', () => {
		const s = fresh();
		const place = { path: '/valuation/sector-rotation/it?sort=label', label: 'Information Technology' };
		rememberOrigin(1, 'tcs', place, s);
		expect(readOrigin(1, 'TCS', s)).toEqual(place);
		expect(readOrigin(1, 'INFY', s)).toBeNull();
		expect(readOrigin(2, 'TCS', s)).toBeNull();
	});

	it('refuses an origin that is not a valuation list', () => {
		const s = fresh();
		rememberOrigin(1, 'TCS', { path: '/valuation/company/INFY', label: 'x' }, s);
		rememberOrigin(1, 'TCS', { path: '/valuation?x=<script>', label: 'x' }, s);
		expect(readOrigin(1, 'TCS', s)).toBeNull();
	});
});
