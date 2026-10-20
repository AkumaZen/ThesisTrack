// DB-backed check of the daily append SQL (arrays appended, same-day close settled, stale marking)
// on throwaway rows. The aggregate recompute is not run here: it reads the whole shared table.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inArray } from 'drizzle-orm';
import { db } from '../src/lib/server/db';
import { breadthCloses } from '../src/lib/server/db/valuationSchema';
import { applyDailyPlan, readDmaRows } from '../src/lib/valuation/server/breadthDmaStore';
import { CHART_FROM, isoToDay } from '../src/lib/valuation/breadthDma';
import { dbReachable } from './dbReachable';

const dbUp = await dbReachable();
const A = `VTA${Date.now()}`;
const B = `VTB${Date.now()}`;
const C = `VTC${Date.now()}`;
const read = async (symbol: string) => (await db.select().from(breadthCloses).where(inArray(breadthCloses.symbol, [symbol])))[0];

describe.skipIf(!dbUp)('applyDailyPlan', () => {
	beforeAll(async () => {
		await db.insert(breadthCloses).values(
			[A, B, C].map((symbol) => ({ symbol, status: 'done', days: [100, 101], closes: [10, 11], lastDay: 101 }))
		);
	});
	afterAll(async () => {
		await db.delete(breadthCloses).where(inArray(breadthCloses.symbol, [A, B, C]));
	});

	it('appends a newer session, settles the same-day close and marks stale, once', async () => {
		const plan = {
			append: [{ symbol: A, day: 102, close: 12.5 }],
			replace: [{ symbol: B, day: 101, close: 11.5 }],
			stale: [C]
		};
		await applyDailyPlan(plan);
		await applyDailyPlan(plan); // a second application changes nothing more
		expect(await read(A)).toMatchObject({ days: [100, 101, 102], closes: [10, 11, 12.5], lastDay: 102, status: 'done' });
		expect(await read(B)).toMatchObject({ days: [100, 101], closes: [10, 11.5], lastDay: 101 });
		expect(await read(C)).toMatchObject({ status: 'stale', closes: [10, 11] });
	});

	it('does nothing for an empty plan', async () => {
		await applyDailyPlan({ append: [], replace: [], stale: [] });
	});
});

describe.skipIf(!dbUp)('readDmaRows (universe filter)', () => {
	const U1 = `VTU1${Date.now()}`;
	const U2 = `VTU2${Date.now()}`;
	const OUT = `VTO${Date.now()}`;
	const since = isoToDay(CHART_FROM);
	// 60 sessions after CHART_FROM, flat at 10 and then a drop to 5 on the last one: below its 50 DMA.
	const days = Array.from({ length: 60 }, (_, i) => since + i);
	const closes = days.map((_, i) => (i === 59 ? 5 : 10));

	beforeAll(async () => {
		await db.insert(breadthCloses).values(
			[U1, U2, OUT].map((symbol) => ({ symbol, status: 'done', days, closes, lastDay: days[59] }))
		);
	});
	afterAll(async () => {
		await db.delete(breadthCloses).where(inArray(breadthCloses.symbol, [U1, U2, OUT]));
	});

	it('counts only the given universe even though breadth_closes holds another done symbol', async () => {
		const rows = await readDmaRows([U1, U2]);
		expect(rows.get(days[59])).toMatchObject({ eligible50: 2, below50: 2 });
		const withExtra = await readDmaRows([U1, U2, OUT]);
		expect(withExtra.get(days[59])).toMatchObject({ eligible50: 3, below50: 3 });
		expect((await readDmaRows([])).size).toBe(0);
	});
});
