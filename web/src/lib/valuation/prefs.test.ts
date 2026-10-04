import { describe, expect, it } from 'vitest';
import { DEFAULT_COLUMNS, DEFAULT_PREFS, mergePrefs, moveColumn, sanitizePrefs } from './prefs';

describe('sanitizePrefs', () => {
	it('gives the defaults for nothing, junk or the wrong shapes', () => {
		expect(sanitizePrefs(undefined)).toEqual(DEFAULT_PREFS);
		expect(sanitizePrefs('x')).toEqual(DEFAULT_PREFS);
		expect(sanitizePrefs({ watchlist: 5, sectorCard: [], lastWatchlistVisit: 'no' })).toEqual(
			DEFAULT_PREFS
		);
	});

	it('keeps valid choices, drops unknown or repeated columns, and keeps their order', () => {
		const p = sanitizePrefs({
			watchlist: {
				columns: ['upside', 'nope', 'cmp', 'upside', 'coverage'],
				sort: { key: 'coverage', dir: 'asc' },
				view: 'list:12'
			},
			lastWatchlistVisit: 1700000000000
		});
		expect(p.watchlist.columns).toEqual(['upside', 'cmp', 'coverage']);
		expect(p.watchlist.sort).toEqual({ key: 'coverage', dir: 'asc' });
		expect(p.watchlist.view).toBe('list:12');
		expect(p.lastWatchlistVisit).toBe(1700000000000);
	});

	it('never allows an empty column set or a malformed view', () => {
		expect(sanitizePrefs({ watchlist: { columns: [] } }).watchlist.columns).toEqual(
			DEFAULT_COLUMNS
		);
		for (const view of ['list:', 'list:0', 'list:abc', 'everything', 'list:1;drop']) {
			expect(sanitizePrefs({ watchlist: { view } }).watchlist.view).toBe('all');
		}
		expect(
			sanitizePrefs({ watchlist: { sort: { key: 'evil', dir: 'up' } } }).watchlist.sort
		).toEqual(DEFAULT_PREFS.watchlist.sort);
	});
});

describe('mergePrefs', () => {
	it('changes only what the patch names and re-validates it', () => {
		const start = sanitizePrefs({ watchlist: { columns: ['cmp', 'upside'], view: 'mine' } });
		const next = mergePrefs(start, { watchlist: { sort: { key: 'cmp', dir: 'asc' } } });
		expect(next.watchlist.columns).toEqual(['cmp', 'upside']);
		expect(next.watchlist.view).toBe('mine');
		expect(next.watchlist.sort).toEqual({ key: 'cmp', dir: 'asc' });
		expect(mergePrefs(start, { watchlist: { columns: ['bogus'] } }).watchlist.columns).toEqual(
			DEFAULT_COLUMNS
		);
		expect(mergePrefs(start, { lastWatchlistVisit: 5 }).lastWatchlistVisit).toBe(5);
		expect(mergePrefs(start, null)).toEqual(start);
	});
});

describe('moveColumn', () => {
	it('swaps with the neighbour and ignores moves off either end', () => {
		expect(moveColumn(['cmp', 'target', 'upside'], 'target', -1)).toEqual([
			'target',
			'cmp',
			'upside'
		]);
		expect(moveColumn(['cmp', 'target', 'upside'], 'target', 1)).toEqual([
			'cmp',
			'upside',
			'target'
		]);
		expect(moveColumn(['cmp', 'target'], 'cmp', -1)).toEqual(['cmp', 'target']);
		expect(moveColumn(['cmp', 'target'], 'target', 1)).toEqual(['cmp', 'target']);
		expect(moveColumn(['cmp'], 'upside', 1)).toEqual(['cmp']);
	});
});
