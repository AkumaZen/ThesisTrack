import { describe, expect, it } from 'vitest';
import { searchSectors, type SectorSearchEntry } from './sectorSearch';

const entries: SectorSearchEntry[] = [
	{ kind: 'sector', label: 'Banking', majorKey: 'banking', majorLabel: 'Banking' },
	{ kind: 'subsector', label: 'Private Banks', majorKey: 'banking', majorLabel: 'Banking', subKey: 'pvt' },
	{
		kind: 'company',
		label: 'HDFC Bank Ltd',
		symbol: 'HDFCBANK',
		majorKey: 'banking',
		majorLabel: 'Banking',
		subKey: 'pvt',
		subLabel: 'Private Banks'
	},
	{ kind: 'sector', label: 'Semiconductors & Electronics Manufacturing', majorKey: 'semi', majorLabel: 'Semiconductors' },
	{
		kind: 'company',
		label: 'Tata Consultancy Services Ltd',
		symbol: 'TCS',
		majorKey: 'it',
		majorLabel: 'IT',
		subKey: 'svc',
		subLabel: 'IT Services'
	}
];

describe('searchSectors', () => {
	it('needs two letters', () => {
		expect(searchSectors(entries, 'b')).toEqual([]);
	});

	it('puts the sector before its subsector and its companies', () => {
		expect(searchSectors(entries, 'bank').map((e) => e.label)).toEqual(['Banking', 'Private Banks', 'HDFC Bank Ltd']);
	});

	it('finds a company by its exact ticker first', () => {
		expect(searchSectors(entries, 'tcs')[0]).toMatchObject({ kind: 'company', symbol: 'TCS' });
	});

	it('matches the start of any word and ignores case', () => {
		expect(searchSectors(entries, 'ELECTRON').map((e) => e.label)).toEqual([
			'Semiconductors & Electronics Manufacturing'
		]);
		expect(searchSectors(entries, 'consult').map((e) => e.label)).toEqual(['Tata Consultancy Services Ltd']);
	});

	it('returns nothing for no match, and respects the limit', () => {
		expect(searchSectors(entries, 'zzz')).toEqual([]);
		expect(searchSectors(entries, 'an', 2)).toHaveLength(2);
	});
});
