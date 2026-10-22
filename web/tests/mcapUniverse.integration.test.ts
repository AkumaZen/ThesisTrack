// DB-backed proof that the wider market cap list (every company above Rs 500 Cr) leaves the breakout
// scanner on its Rs 500 Cr to Rs 20,000 Cr band, while the breadth universe takes all of it.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inArray } from 'drizzle-orm';
import { db } from '../src/lib/server/db';
import { mcapUniverse } from '../src/lib/server/db/valuationSchema';
import {
	listActiveUniverse,
	listBreadthUniverse,
	listUniverseSymbols,
	listUniverseSymbolsWithoutSeries
} from '../src/lib/valuation/server/mcapUniverseStore';
import { dbReachable } from './dbReachable';

const dbUp = await dbReachable();
const stamp = Date.now();
const rows = [
	{ n: 'MID', isin: `INZ${stamp}01`, cap: '5000.00' },
	{ n: 'EDGE', isin: `INZ${stamp}02`, cap: '19999.99' },
	{ n: 'BIG', isin: `INZ${stamp}03`, cap: '20000.00' },
	{ n: 'HUGE', isin: `INZ${stamp}04`, cap: '1873286.78' }
].map((r) => ({
	isin: r.isin,
	companyName: `Throwaway ${r.n}`,
	marketCapCr: r.cap,
	mcapAsOf: '2026-06-30',
	priceSourceStatus: 'matched',
	priceExchange: 'NSE',
	angelNseToken: '1',
	symbol: `VT${r.n}${stamp}`,
	active: true
}));
const symbols = rows.map((r) => r.symbol);
const mine = (list: (string | null)[]) => list.filter((s): s is string => !!s && symbols.includes(s)).sort();

describe.skipIf(!dbUp)('market cap list reads', () => {
	beforeAll(async () => {
		await db.insert(mcapUniverse).values(rows);
	});
	afterAll(async () => {
		await db.delete(mcapUniverse).where(inArray(mcapUniverse.isin, rows.map((r) => r.isin)));
	});

	it('the scanner reads stop below Rs 20,000 Cr', async () => {
		const scanner = [`VTMID${stamp}`, `VTEDGE${stamp}`].sort();
		expect(mine((await listActiveUniverse()).map((c) => c.symbol))).toEqual(scanner);
		expect(mine(await listUniverseSymbols())).toEqual(scanner);
		expect(mine(await listUniverseSymbolsWithoutSeries())).toEqual(scanner);
	});

	it('the breadth universe takes every active company with a price source, whatever its size', async () => {
		expect(mine((await listBreadthUniverse()).map((u) => u.symbol))).toEqual([...symbols].sort());
	});
});
