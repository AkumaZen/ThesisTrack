import { describe, expect, it } from 'vitest';
import { moduleOf } from './modules';

describe('moduleOf', () => {
	it.each([
		['/', 'thesis'],
		['/company/ABC', 'thesis'],
		['/review', 'thesis'],
		['/account/password', 'thesis'],
		['/valuation', 'valuation'],
		['/valuation/company/TCS', 'valuation'],
		['/valuation/master-tracker', 'valuation'],
		['/valuation/alerts', 'alerts'],
		['/valuation/tracking', 'alerts'],
		['/valuation/settings', 'markets'],
		['/valuation/sector-rotation', 'markets'],
		['/valuation/sector-rotation/auto', 'markets'],
		['/valuation/sector-rotation/auto/tyres', 'markets'],
		['/valuation/sectors', 'markets'],
		['/valuation/stage-scanner', 'markets'],
		['/valuation/compare', 'valuation'],
		['/valuation/results', 'markets'],
		['/valuation/returns', 'markets'],
		['/valuation/breadth', 'markets'],
		['/valuation/scans', 'markets'],
		['/valuation/scans/shared/3f2b8c1e-9d4a-4e7b-8a1c-0123456789ab', 'markets'],
		['/valuation/announcements', 'filings'],
		['/valuation/filings/TCS', 'filings'],
		['/valuation/insider-trades', 'filings'],
		['/valuation/corporate-actions', 'filings'],
		['/valuation/concalls', 'valuation'],
		['/valuation/concalls/HFCL', 'valuation'],
		['/valuation/red-flags', 'valuation'],
		['/valuation/lists', 'valuation'],
		['/valuation/price-alerts', 'alerts']
	] as const)('%s is %s', (path, expected) => expect(moduleOf(path)).toBe(expected));

	it('does not confuse similar prefixes', () => {
		expect(moduleOf('/valuation/sectorsx')).toBe('valuation');
		expect(moduleOf('/valuationx')).toBe('thesis');
	});
});
