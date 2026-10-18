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
		['/valuation/compare', 'analysis']
	] as const)('%s is %s', (path, expected) => expect(moduleOf(path)).toBe(expected));

	it('does not confuse similar prefixes', () => {
		expect(moduleOf('/valuation/sectorsx')).toBe('valuation');
		expect(moduleOf('/valuationx')).toBe('thesis');
	});
});
