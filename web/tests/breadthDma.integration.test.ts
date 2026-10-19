// DB-backed check of the daily append SQL (arrays appended, same-day close settled, stale marking)
// on throwaway rows. The aggregate recompute is not run here: it reads the whole shared table.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inArray } from 'drizzle-orm';
import { db } from '../src/lib/server/db';
import { breadthCloses } from '../src/lib/server/db/valuationSchema';
import { applyDailyPlan } from '../src/lib/valuation/server/breadthDmaStore';
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
