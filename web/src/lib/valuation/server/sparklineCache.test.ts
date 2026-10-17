import { describe, expect, it, vi } from 'vitest';

// The module imports the database and Angel One client; only the pure helpers are tested here.
vi.mock('./companyGrowthSeries', () => ({ readCachedCloses: vi.fn() }));
vi.mock('$lib/server/db', () => ({ db: {} }));
vi.mock('./angelone', () => ({ angelListings: vi.fn() }));

import { classifySparkline, sparklineTail, SPARKLINE_SESSIONS } from './sparklineCache';

const rising = (n: number) => Array.from({ length: n }, (_, i) => 100 + i);

describe('sparklineTail', () => {
	it('keeps the most recent sessions only', () => {
		const tail = sparklineTail(rising(300));
		expect(tail).toHaveLength(SPARKLINE_SESSIONS);
		expect(tail.at(-1)).toBe(399);
	});
	it('drops unusable prices', () => {
		expect(sparklineTail([1, NaN, 0, -3, 2])).toEqual([1, 2]);
	});
});

describe('classifySparkline', () => {
	it('uses the stored series', () => {
		const r = classifySparkline({ closes: rising(10), fetchedAt: 5 }, true);
		expect(r).toMatchObject({ kind: 'ok', fetchedAt: 5 });
	});
	it('still draws a stored series when the listing could not be checked', () => {
		expect(classifySparkline({ closes: rising(10), fetchedAt: 5 }, null).kind).toBe('ok');
	});
	it('reports nothing stored for a listed company (fixed by a refresh, not by giving up)', () => {
		expect(classifySparkline(null, true).kind).toBe('not_stored');
	});
	it('does not call an unchecked symbol unlisted', () => {
		expect(classifySparkline(null, null).kind).toBe('not_stored');
	});
	it('reports a symbol Angel One does not list (e.g. GUJGASLTD) as having no price source', () => {
		expect(classifySparkline(null, false).kind).toBe('unlisted');
	});
	it('treats a one-point series as nothing stored', () => {
		expect(classifySparkline({ closes: [10], fetchedAt: 1 }, true).kind).toBe('not_stored');
	});
	it('falls back to the closes the old live route saved when the growth series has none', () => {
		const r = classifySparkline(null, false, { closes: rising(10), fetchedAt: 9 });
		expect(r).toMatchObject({ kind: 'ok', fetchedAt: 9 });
	});
	it('prefers the growth series over the legacy closes', () => {
		const r = classifySparkline({ closes: rising(10), fetchedAt: 5 }, true, { closes: rising(10), fetchedAt: 9 });
		expect(r).toMatchObject({ kind: 'ok', fetchedAt: 5 });
	});
});
