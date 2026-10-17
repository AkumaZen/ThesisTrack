import { describe, expect, it, vi } from 'vitest';

const stored = vi.hoisted(() => ({ value: null as unknown }));
vi.mock('$lib/server/db', () => ({
	db: { select: () => ({ from: () => ({ where: async () => (stored.value ? [stored.value] : []) }) }) }
}));
vi.mock('./angelone', () => ({ fetchDailyCandles: vi.fn() }));

import { readFreshCandles } from './companyGrowthSeries';

const NOW = Date.parse('2026-10-19T04:00:00Z');
const day = (offset: number) => new Date(NOW - offset * 86_400_000).toISOString().slice(0, 10);
const candles = (n: number) =>
	Array.from({ length: n }, (_, i) => ({
		date: `${day(n - i)}T00:00:00+05:30`,
		open: 1,
		high: 1,
		low: 1,
		close: 1,
		volume: 1
	}));

describe('readFreshCandles', () => {
	it('returns the stored candles inside the requested window when fresh', async () => {
		stored.value = { symbol: 'A', candles: candles(500), fetchedAt: NOW - 3_600_000 };
		const out = await readFreshCandles('A', 400, NOW);
		expect(out!.length).toBeGreaterThan(300);
		expect(out!.length).toBeLessThanOrEqual(401);
	});
	it('returns null when the stored series is older than a day (caller fetches live)', async () => {
		stored.value = { symbol: 'A', candles: candles(500), fetchedAt: NOW - 30 * 3_600_000 };
		expect(await readFreshCandles('A', 400, NOW)).toBeNull();
	});
	it('returns null when nothing is stored or the stored series is too short', async () => {
		stored.value = null;
		expect(await readFreshCandles('A', 400, NOW)).toBeNull();
		stored.value = { symbol: 'A', candles: candles(5), fetchedAt: NOW };
		expect(await readFreshCandles('A', 400, NOW)).toBeNull();
	});
});
