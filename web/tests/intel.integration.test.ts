// DB-backed run of the results calendar, tags and the "only important" setting with a fake NSE and push:
// per-symbol refresh throttle, meeting dedupe, tags stored and back-filled, routine filings not pushed.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, inArray, like } from 'drizzle-orm';
import { db } from '../src/lib/server/db';
import { users } from '../src/lib/server/db/schema';
import {
	announcementDeliveries,
	announcements,
	boardMeetings,
	pushSubscriptions,
	symbolRefresh,
	trackedCompanies
} from '../src/lib/server/db/valuationSchema';
import { runAnnouncementCheck, type JobDeps } from '../src/lib/valuation/server/announcementJob';
import { claimDueSymbols, listUpcomingMeetings, setOnlyImportant } from '../src/lib/valuation/server/intelStore';
import type { ParsedAnnouncement } from '../src/lib/valuation/announcements';
import type { ParsedMeeting } from '../src/lib/valuation/boardMeetings';
import { dbReachable } from './dbReachable';

const dbUp = await dbReachable();
const RUN = Date.now();
const SYMBOL = `VI${RUN}`;
const NOW = new Date();
const mins = (n: number) => new Date(NOW.getTime() - n * 60_000);
const day = (offset: number) => new Date(NOW.getTime() + offset * 86_400_000 + 5.5 * 3600_000).toISOString().slice(0, 10);

let userId = 0;
const titles: string[] = [];
let meetingFetches = 0;

const row = (key: string, ago: number, subject: string, details = subject): ParsedAnnouncement => ({
	dedupeKey: `vitest-intel:${RUN}:${key}`,
	nseSymbol: SYMBOL,
	companyName: 'Intel Ltd',
	subject,
	details,
	announcedAt: mins(ago),
	pdfUrl: null
});

const meeting = (offset: number, isResults: boolean): ParsedMeeting => ({
	dedupeKey: `${SYMBOL}|${day(offset)}|${isResults ? 'results' : 'other'}`,
	nseSymbol: SYMBOL,
	companyName: 'Intel Ltd',
	meetingDate: day(offset),
	purpose: isResults ? 'Financial results' : 'Fund Raising',
	isResults,
	source: 'nse'
});

function deps(over: Partial<JobDeps> = {}): Partial<JobDeps> {
	return {
		fetchAnnouncements: async () => [],
		summarise: async () => 'summary',
		send: async (_t, payload) => {
			titles.push((JSON.parse(payload) as { title: string }).title);
		},
		summariesOn: () => false,
		pushOn: () => true,
		now: () => NOW,
		calendar: {
			fetchMeetings: async (symbol) => {
				if (symbol !== SYMBOL) return [];
				meetingFetches++;
				return [meeting(3, true), meeting(10, false)];
			}
		},
		...over
	};
}

describe.skipIf(!dbUp)('results calendar, tags and important-only (database)', () => {
	beforeAll(async () => {
		const [u] = await db
			.insert(users)
			.values({ email: `vitest-intel-${RUN}@example.invalid`, passwordHash: 'x', displayName: `Vitest.Intel${RUN}` })
			.returning({ id: users.id });
		userId = u.id;
		await db.insert(trackedCompanies).values({ userId, nseSymbol: SYMBOL, companyName: 'Intel Ltd', createdAt: mins(600) });
		await db.insert(pushSubscriptions).values({ userId, endpoint: `https://push.example/${RUN}/live`, p256dh: 'p', auth: 'a' });
	});

	afterAll(async () => {
		if (!dbUp) return;
		await db.delete(announcements).where(eq(announcements.nseSymbol, SYMBOL));
		await db.delete(boardMeetings).where(eq(boardMeetings.nseSymbol, SYMBOL));
		await db.delete(symbolRefresh).where(like(symbolRefresh.symbol, `VI${RUN}%`));
		await db.delete(users).where(eq(users.id, userId));
	});

	it('refreshes a symbol once per interval, stores meetings once, and lists them by date', async () => {
		const first = await runAnnouncementCheck(deps());
		expect(first.intel.meetingsStored).toBeGreaterThanOrEqual(2);
		expect(meetingFetches).toBe(1);
		const again = await runAnnouncementCheck(deps());
		expect(meetingFetches).toBe(1); // throttled: not due for another 6 hours
		expect(again.errors).toEqual([]);

		const stored = await db.select().from(boardMeetings).where(eq(boardMeetings.nseSymbol, SYMBOL));
		expect(stored).toHaveLength(2); // the same two meetings were never stored twice
		const upcoming = await listUpcomingMeetings([SYMBOL], day(0));
		expect(upcoming.map((m) => [m.meetingDate, m.isResults])).toEqual([[day(3), true], [day(10), false]]);

		const later = new Date(NOW.getTime() + 6 * 3600_000 + 1000);
		await runAnnouncementCheck(deps({ now: () => later }));
		expect(meetingFetches).toBe(2); // due again after 6 hours
	});

	it('retries a failed symbol after 15 minutes, not 6 hours', async () => {
		const kind = 'vitest-throttle';
		const sym = `VI${RUN}T`;
		expect(await claimDueSymbols(kind, [sym], NOW, 6 * 3600_000, 5)).toEqual([sym]);
		expect(await claimDueSymbols(kind, [sym], new Date(NOW.getTime() + 60_000), 6 * 3600_000, 5)).toEqual([]);
		await db.update(symbolRefresh).set({ ok: false }).where(and(eq(symbolRefresh.kind, kind), eq(symbolRefresh.symbol, sym)));
		expect(await claimDueSymbols(kind, [sym], new Date(NOW.getTime() + 16 * 60_000), 6 * 3600_000, 5)).toEqual([sym]);
		await db.delete(symbolRefresh).where(eq(symbolRefresh.kind, kind));
	});

	it('keeps a meeting failure from breaking the run', async () => {
		await db.delete(symbolRefresh).where(like(symbolRefresh.symbol, `VI${RUN}%`));
		const r = await runAnnouncementCheck(
			deps({
				now: () => new Date(NOW.getTime() + 12 * 3600_000), // the earlier test refreshed up to +6h
				calendar: {
					fetchMeetings: async () => {
						throw new Error('NSE down');
					}
				}
			})
		);
		expect(r.errors.join('; ')).toContain('NSE down');
		const [state] = await db
			.select()
			.from(symbolRefresh)
			.where(and(eq(symbolRefresh.kind, 'board'), eq(symbolRefresh.symbol, SYMBOL)));
		expect(state.ok).toBe(false);
	});

	it('tags new rows, back-fills untagged ones and prefixes the push title', async () => {
		await db.insert(announcements).values({
			dedupeKey: `vitest-intel:${RUN}:old`,
			nseSymbol: SYMBOL,
			companyName: 'Intel Ltd',
			subject: 'Trading Window',
			details: 'closure',
			announcedAt: mins(90000) // too old to push; only the back-fill matters
		});
		const r = await runAnnouncementCheck(
			deps({ fetchAnnouncements: async () => [row('res', 20, 'Outcome of Board Meeting', 'the financial results for the quarter')] })
		);
		expect(r.newAnnouncements).toBe(1);
		const rows = await db.select().from(announcements).where(eq(announcements.nseSymbol, SYMBOL));
		const byKey = Object.fromEntries(rows.map((a) => [a.dedupeKey.split(':').pop(), a.tag]));
		expect(byKey).toMatchObject({ res: 'results', old: 'routine' });
		expect(titles.at(-1)).toBe(`[Results] ${SYMBOL}: Outcome of Board Meeting`);
	});

	it('with "only important" on, routine filings are stored and claimed but not pushed', async () => {
		await setOnlyImportant(userId, true);
		const before = titles.length;
		const r = await runAnnouncementCheck(
			deps({
				fetchAnnouncements: async () => [
					row('routine', 15, 'Trading Window', 'closure of trading window'),
					row('big', 14, 'Bagging/Receiving of orders/contracts', 'order worth 100 crore')
				]
			})
		);
		expect(r.suppressed).toBe(1);
		expect(titles.slice(before)).toEqual([`[Order win] ${SYMBOL}: Bagging/Receiving of orders/contracts`]);
		const stored = await db.select().from(announcements).where(eq(announcements.dedupeKey, `vitest-intel:${RUN}:routine`));
		expect(stored).toHaveLength(1);
		const claimed = await db
			.select()
			.from(announcementDeliveries)
			.where(and(eq(announcementDeliveries.userId, userId), inArray(announcementDeliveries.announcementId, [stored[0].id])));
		expect(claimed).toHaveLength(1);

		await setOnlyImportant(userId, false);
		const second = await runAnnouncementCheck(deps({ fetchAnnouncements: async () => [row('routine2', 5, 'Trading Window', 'closure')] }));
		expect(second.suppressed).toBe(0);
		expect(titles.at(-1)).toBe(`[Routine] ${SYMBOL}: Trading Window`);
	});
});
