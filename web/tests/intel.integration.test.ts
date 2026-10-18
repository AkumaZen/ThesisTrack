// DB-backed run of the results calendar, tags and the "only important" setting with a fake NSE and push:
// per-symbol refresh throttle, meeting dedupe, tags stored and back-filled, routine filings not pushed.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, inArray, like, ne } from 'drizzle-orm';
import { db } from '../src/lib/server/db';
import { users } from '../src/lib/server/db/schema';
import {
	announcementDeliveries,
	announcements,
	boardMeetings,
	dealDeliveries,
	marketDeals,
	pushSubscriptions,
	shareholdingSnapshots,
	symbolRefresh,
	trackedCompanies
} from '../src/lib/server/db/valuationSchema';
import { runAnnouncementCheck, type JobDeps } from '../src/lib/valuation/server/announcementJob';
import { claimDueSymbols, listUpcomingMeetings, setOnlyImportant } from '../src/lib/valuation/server/intelStore';
import type { ParsedAnnouncement } from '../src/lib/valuation/announcements';
import type { ParsedMeeting } from '../src/lib/valuation/boardMeetings';
import type { ParsedDeal } from '../src/lib/valuation/deals';
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
		intel: {
			fetchDeals: async () => [],
			fetchShareholding: async () => null,
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
		// Refresh state is a throttle on shared sources; earlier runs leave future-dated rows behind.
		await db.delete(symbolRefresh);
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
		await db.delete(marketDeals).where(eq(marketDeals.nseSymbol, SYMBOL));
		await db.delete(shareholdingSnapshots).where(eq(shareholdingSnapshots.nseSymbol, SYMBOL));
		await db.delete(symbolRefresh);
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
		// Other watched companies (a real database has many) must not crowd this one out of the per-run cap.
		await db.update(symbolRefresh).set({ refreshedAt: later }).where(and(eq(symbolRefresh.kind, 'board'), ne(symbolRefresh.symbol, SYMBOL)));
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
				intel: {
					fetchDeals: async () => [],
					fetchShareholding: async () => null,
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
			deps({ fetchAnnouncements: async (s) => (s === SYMBOL ? [row('res', 20, 'Outcome of Board Meeting', 'the financial results for the quarter')] : []) })
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
				fetchAnnouncements: async (s) =>
					s !== SYMBOL ? [] : [
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

	it('stores deals of watched companies once, pushes a new deal once, and keeps the shareholding snapshot', async () => {
		const later = new Date(NOW.getTime() + 24 * 3600_000);
		const dealDay = new Date(later.getTime() + 5.5 * 3600_000).toISOString().slice(0, 10);
		const deal = (over: Partial<ParsedDeal>): ParsedDeal => ({
			dedupeKey: `vitest-intel:${RUN}:deal`,
			kind: 'bulk',
			nseSymbol: SYMBOL,
			companyName: 'Intel Ltd',
			dealDate: dealDay,
			clientName: 'ACME FUND',
			side: 'BUY',
			quantity: 250000,
			price: 101.5,
			...over
		});
		let dealFetches = 0;
		const run = () =>
			runAnnouncementCheck(
				deps({
					now: () => later,
					intel: {
						fetchMeetings: async () => [],
						fetchDeals: async () => {
							dealFetches++;
							return [deal({}), deal({ nseSymbol: `ZZ${RUN}`, dedupeKey: `vitest-intel:${RUN}:other` })];
						},
						fetchShareholding: async (symbol) =>
							symbol === SYMBOL
								? { period: 'Sep 2026', promoters: 50, fiis: 12, diis: 8, public: 30, pledgedPct: null, prevPeriod: 'Jun 2026', prevPromoters: 50, prevFiis: 10, prevDiis: 8, prevPublic: 32 }
								: null
					}
				})
			);
		const before = titles.length;
		const first = await run();
		expect(first.intel.newDeals).toBe(1); // the deal of an unwatched company was not stored
		expect(first.intel.shareholdingUpdated).toBe(1);
		expect(first.dealsNotified).toBe(1);
		expect(titles.slice(before)).toEqual([`[Bulk deal] ${SYMBOL}: bought 2.5 lakh shares`]);

		const again = await run();
		expect(dealFetches).toBe(1); // 3-hour throttle
		expect(again.dealsNotified).toBe(0);
		const stored = await db.select().from(marketDeals).where(eq(marketDeals.nseSymbol, SYMBOL));
		expect(stored).toHaveLength(1);
		expect(await db.select().from(dealDeliveries).where(eq(dealDeliveries.userId, userId))).toHaveLength(1);

		// A later poll that sees the very same deal again stores and pushes nothing.
		const much = new Date(later.getTime() + 4 * 3600_000);
		const repeat = await runAnnouncementCheck(deps({ now: () => much, intel: { fetchMeetings: async () => [], fetchDeals: async () => [deal({})], fetchShareholding: async () => null } }));
		expect(repeat.intel.newDeals).toBe(0);
		expect(repeat.dealsNotified).toBe(0);

		const [snap] = await db.select().from(shareholdingSnapshots).where(eq(shareholdingSnapshots.nseSymbol, SYMBOL));
		expect(snap).toMatchObject({ period: 'Sep 2026', fiis: 12, prevFiis: 10 });
	});

	it('a failing deals source is reported and does not stop the run', async () => {
		const later = new Date(NOW.getTime() + 48 * 3600_000);
		const r = await runAnnouncementCheck(
			deps({
				now: () => later,
				intel: {
					fetchMeetings: async () => [],
					fetchShareholding: async () => null,
					fetchDeals: async () => {
						throw new Error('NSE blocked');
					}
				}
			})
		);
		expect(r.errors.join('; ')).toContain('NSE blocked');
	});
});
