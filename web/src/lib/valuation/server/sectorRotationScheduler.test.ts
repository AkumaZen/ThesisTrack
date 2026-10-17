import { describe, expect, it, vi } from 'vitest';

vi.mock('$lib/server/db', () => ({ db: {} }));
vi.mock('./sectorStore', () => ({ listAllSymbols: vi.fn() }));
vi.mock('./companyGrowthSeries', () => ({ refreshCompanySeries: vi.fn() }));
vi.mock('./benchmarkSeries', () => ({ refreshBenchmarkCandles: vi.fn() }));
vi.mock('./alertChecks', () => ({ runStructuralChecks: vi.fn() }));

import { buildRefreshQueue } from './sectorRotationScheduler';

const HOUR = 3_600_000;

describe('buildRefreshQueue', () => {
	it('includes watchlist companies that are in no sector basket', () => {
		const q = buildRefreshQueue([['TCS', 'INFY'], ['HFCL', 'TCS']], new Map(), 100 * HOUR);
		expect(q.sort()).toEqual(['HFCL', 'INFY', 'TCS']);
	});
	it('de-duplicates case-insensitively', () => {
		expect(buildRefreshQueue([['tcs'], ['TCS']], new Map(), 100 * HOUR)).toEqual(['TCS']);
	});
	it('puts never-fetched symbols first, then the stalest', () => {
		const now = 100 * HOUR;
		const fetched = new Map([
			['AAA', now - 5 * HOUR],
			['BBB', now - 20 * HOUR]
		]);
		expect(buildRefreshQueue([['AAA', 'BBB', 'NEW']], fetched, now)).toEqual(['NEW', 'BBB', 'AAA']);
	});
	it('skips symbols fetched within the last half hour', () => {
		const now = 100 * HOUR;
		const fetched = new Map([['FRESH', now - 60_000]]);
		expect(buildRefreshQueue([['FRESH', 'OLD']], fetched, now)).toEqual(['OLD']);
	});
});
