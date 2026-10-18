// DB-backed run of the announcement job with a fake NSE, summariser and push service:
// new-since-tracking, once-only delivery, dead subscription cleanup, and the summary retry limit.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import { db } from '../src/lib/server/db';
import { users } from '../src/lib/server/db/schema';
import {
	announcementDeliveries,
	announcements,
	pushSubscriptions,
	trackedCompanies
} from '../src/lib/server/db/valuationSchema';
import { runAnnouncementCheck, type JobDeps } from '../src/lib/valuation/server/announcementJob';
import type { ParsedAnnouncement } from '../src/lib/valuation/announcements';
import { dbReachable } from './dbReachable';

const dbUp = await dbReachable();
const RUN = Date.now();
const SYMBOL = `VT${RUN}`;
const NOW = new Date();
const mins = (n: number) => new Date(NOW.getTime() - n * 60_000);

let userId = 0;
const sent: string[] = [];

const row = (key: string, ago: number, subject: string): ParsedAnnouncement => ({
	dedupeKey: `vitest:${RUN}:${key}`,
	nseSymbol: SYMBOL,
	companyName: 'Vitest Ltd',
	subject,
	details: subject,
	announcedAt: mins(ago),
	pdfUrl: null
});

function deps(over: Partial<JobDeps> = {}): Partial<JobDeps> {
	return {
		fetchAnnouncements: async (symbol) =>
			symbol === SYMBOL ? [row('old', 120, 'Old filing'), row('new', 10, 'New filing')] : [],
		summarise: async () => 'A short summary.',
		send: async (t) => {
			sent.push(t.endpoint);
			if (t.endpoint.endsWith('/dead')) throw Object.assign(new Error('gone'), { statusCode: 410 });
		},
		summariesOn: () => false,
		pushOn: () => true,
		telegramOn: () => false,
		now: () => NOW,
		// Personal price alerts are not under test here: no prices, so nothing fires.
		alerts: { liveQuotes: async () => new Map(), storedCloses: async () => new Map(), marketOpen: () => false },
		intel: { fetchMeetings: async () => [], fetchDeals: async () => [], fetchShareholding: async () => null },
		...over
	};
}

describe.skipIf(!dbUp)('runAnnouncementCheck (database)', () => {
	beforeAll(async () => {
		const [u] = await db
			.insert(users)
			.values({ email: `vitest-ann-${RUN}@example.invalid`, passwordHash: 'x', displayName: `Vitest.Ann${RUN}` })
			.returning({ id: users.id });
		userId = u.id;
		await db.insert(trackedCompanies).values({ userId, nseSymbol: SYMBOL, companyName: 'Vitest Ltd', createdAt: mins(60) });
		await db.insert(pushSubscriptions).values([
			{ userId, endpoint: `https://push.example/${RUN}/live`, p256dh: 'p', auth: 'a' },
			{ userId, endpoint: `https://push.example/${RUN}/dead`, p256dh: 'p', auth: 'a' }
		]);
	});

	afterAll(async () => {
		if (!dbUp) return;
		await db.delete(announcements).where(eq(announcements.nseSymbol, SYMBOL));
		await db.delete(users).where(eq(users.id, userId)); // cascades tracking, subscriptions, deliveries
	});

	it('stores everything but pushes only what is new since tracking, once, and drops dead subscriptions', async () => {
		const first = await runAnnouncementCheck(deps());
		expect(first.newAnnouncements).toBe(2);
		expect(first.notified).toBe(1);
		expect(first.pushSent).toBe(1);
		expect(first.subscriptionsRemoved).toBe(1);
		expect(sent).toHaveLength(2);
		const left = await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, userId));
		expect(left.map((s) => s.endpoint)).toEqual([`https://push.example/${RUN}/live`]);
		expect(left[0].lastSuccessAt).not.toBeNull();

		const second = await runAnnouncementCheck(deps());
		expect(second.newAnnouncements).toBe(0);
		expect(second.notified).toBe(0);
		expect(sent).toHaveLength(2);
		const delivered = await db.select().from(announcementDeliveries).where(eq(announcementDeliveries.userId, userId));
		expect(delivered).toHaveLength(1);
	});

	it('waits for the summary, then gives up after three failures and pushes the raw subject', async () => {
		const [fresh] = await db
			.insert(announcements)
			.values({ ...row('summary', 5, 'Needs summary'), dedupeKey: `vitest:${RUN}:summary` })
			.returning();
		const fail = deps({ fetchAnnouncements: async () => [], summariesOn: () => true, summarise: async () => { throw new Error('llm down'); } });
		const before = sent.length;
		for (let i = 0; i < 2; i++) {
			const r = await runAnnouncementCheck(fail);
			expect(r.notified).toBe(0);
		}
		const third = await runAnnouncementCheck(fail);
		expect(third.notified).toBe(1);
		expect(sent.length).toBe(before + 1);
		const [after] = await db.select().from(announcements).where(inArray(announcements.id, [fresh.id]));
		expect(after.summary).toBeNull();
		expect(after.summaryAttempts).toBe(3);
	});

	it('pushes the summary when the LLM works', async () => {
		await db.insert(announcements).values({ ...row('good', 3, 'Summarisable'), dedupeKey: `vitest:${RUN}:good` });
		const r = await runAnnouncementCheck(deps({ fetchAnnouncements: async () => [], summariesOn: () => true }));
		expect(r.summarised).toBe(1);
		expect(r.notified).toBe(1);
		const [a] = await db.select().from(announcements).where(eq(announcements.dedupeKey, `vitest:${RUN}:good`));
		expect(a.summary).toBe('A short summary.');
	});

	it('claims nothing while push is not configured', async () => {
		await db.insert(announcements).values({ ...row('nopush', 2, 'Held back'), dedupeKey: `vitest:${RUN}:nopush` });
		const r = await runAnnouncementCheck(deps({ fetchAnnouncements: async () => [], pushOn: () => false }));
		expect(r.notified).toBe(0);
		const later = await runAnnouncementCheck(deps({ fetchAnnouncements: async () => [] }));
		expect(later.notified).toBe(1);
	});
});
