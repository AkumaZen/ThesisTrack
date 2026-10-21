import { describe, expect, it, vi } from 'vitest';

const majors: Record<string, { key: string; label: string; subsectorKeys: string[] }> = {
	banking: { key: 'banking', label: 'Banking', subsectorKeys: ['private_banks'] }
};
const baskets: Record<string, { key: string; label: string; symbols: string[] }> = {
	private_banks: { key: 'private_banks', label: 'Private banks', symbols: ['HDFCBANK'] },
	elsewhere: { key: 'elsewhere', label: 'Elsewhere', symbols: ['TCS'] }
};

vi.mock('$lib/valuation/server/sectorStore', () => ({
	findAnyMajorSector: async (key: string) => majors[key] ?? null,
	findAnyCustomSector: async (key: string) => baskets[key] ?? null
}));
vi.mock('$lib/valuation/server/sectorEarningsStore', () => ({ getSectorEarnings: async () => null }));

import { load } from './+page.server';

const run = (key: string, subKey: string) =>
	(load as unknown as (e: unknown) => Promise<unknown>)({ params: { key, subKey } });

describe('basket page load', () => {
	it('returns the basket when it belongs to the major', async () => {
		expect(await run('banking', 'private_banks')).toMatchObject({ key: 'private_banks', symbols: ['HDFCBANK'] });
	});

	it('redirects a retired or foreign basket to its major page', async () => {
		for (const subKey of ['banks', 'elsewhere']) {
			await expect(run('banking', subKey)).rejects.toMatchObject({
				status: 307,
				location: '/valuation/sector-rotation/banking'
			});
		}
	});

	it('redirects to the sector list when the major is gone too', async () => {
		await expect(run('retired_major', 'banks')).rejects.toMatchObject({
			status: 307,
			location: '/valuation/sector-rotation'
		});
	});
});
