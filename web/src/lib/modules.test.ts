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
		['/valuation/alerts', 'valuation'],
		['/valuation/tracking', 'valuation'],
		['/valuation/settings', 'valuation'],
		['/valuation/sector-rotation', 'sector'],
		['/valuation/sector-rotation/auto', 'sector'],
		['/valuation/sector-rotation/auto/tyres', 'sector'],
		['/valuation/sectors', 'sector'],
		['/valuation/stage-scanner', 'analysis'],
		['/valuation/compare', 'analysis'],
		['/valuation/results', 'analysis'],
		['/valuation/returns', 'analysis'],
		['/valuation/breadth', 'analysis'],
		['/valuation/scans', 'analysis'],
		['/valuation/scans/shared/3f2b8c1e-9d4a-4e7b-8a1c-0123456789ab', 'analysis'],
		['/valuation/announcements', 'analysis'],
		['/valuation/filings/TCS', 'analysis'],
		['/valuation/insider-trades', 'analysis'],
		['/valuation/corporate-actions', 'analysis'],
		['/valuation/concalls', 'analysis'],
		['/valuation/concalls/HFCL', 'analysis'],
		['/valuation/red-flags', 'analysis'],
		['/valuation/lists', 'valuation'],
		['/valuation/price-alerts', 'valuation']
	] as const)('%s is %s', (path, expected) => expect(moduleOf(path)).toBe(expected));

	it('does not confuse similar prefixes', () => {
		expect(moduleOf('/valuation/sectorsx')).toBe('valuation');
		expect(moduleOf('/valuationx')).toBe('thesis');
	});
});
