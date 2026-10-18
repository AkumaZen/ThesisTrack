// DB-backed checks of the market intel layer: resumable feed filling, feed filters and trending
// words, insider filters, price and shareholding alerts, list sections, and the alert path of the
// one-minute poller. NSE and the broker are faked; nothing leaves the machine.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, gte, inArray, like } from 'drizzle-orm';
import { db } from '../src/lib/server/db';
import { users } from '../src/lib/server/db/schema';
import { announcements, pushSubscriptions, shareholdingSnapshots, symbolRefresh, trackedCompanies } from '../src/lib/server/db/valuationSchema';
import { holdingAlertDeliveries, holdingAlertSettings, insiderTrades, priceAlertRules, sastDisclosures, corporateActions } from '../src/lib/server/db/marketIntelSchema';
import { runMarketIntel, refreshCompanyFilings, addDays, BACKFILL_DAYS, type MarketIntelDeps } from '../src/lib/valuation/server/marketIntelJob';
import { emptyAlertSummary, runHoldingAlerts, runPriceAlerts } from '../src/lib/valuation/server/alertsJob';
import { runAnnouncementCheck } from '../src/lib/valuation/server/announcementJob';
import * as store from '../src/lib/valuation/server/marketIntelStore';
import { parseFeedFilters, presetScan } from '../src/lib/valuation/announcementScans';
import { parseInsiderFilters, type ParsedInsiderTrade } from '../src/lib/valuation/insiderTrades';
import type { ParsedAnnouncement } from '../src/lib/valuation/announcements';
import type { PushPayload } from '../src/lib/valuation/announcements';
import { dbReachable } from './dbReachable';

const dbUp = await dbReachable();
const RUN = Date.now();
const SYM = `VM${RUN}`;
/** A clock far from real data so the throttle rows this test writes can never meet real ones. */
const NOW = new Date('2041-03-10T10:00:00Z');
const TODAY = '2041-03-10';

let userId = 0;
let otherUserId = 0;

const ann = (key: string, hoursAgo: number, subject: string, details = subject): ParsedAnnouncement => ({
	dedupeKey: `vitest-mi:${RUN}:${key}`,
	nseSymbol: SYM,
	companyName: 'Vitest Market Ltd',
	subject,
	details,
	announcedAt: new Date(Date.now() - hoursAgo * 3600_000),
	pdfUrl: null
});

const trade = (key: string, over: Partial<ParsedInsiderTrade> = {}): ParsedInsiderTrade => ({
	dedupeKey: `vitest-mi:${RUN}:${key}`,
	nseSymbol: SYM,
	companyName: 'Vitest Market Ltd',
	personName: 'Asha Rao',
	personCategory: 'Promoters',
	securityType: 'Equity Shares',
	txnType: 'Buy',
	mode: 'Market Purchase',
	quantity: 1000,
	value: 500_000,
	beforeShares: 10_000,
	beforePct: 1,
	afterShares: 11_000,
	afterPct: 1.1,
	fromDate: '2026-03-02',
	toDate: '2026-03-02',
	broadcastAt: new Date('2026-03-03T10:00:00Z'),
	sourceUrl: null,
	...over
});

const sent: { userId: number; payload: PushPayload }[] = [];
const notify = async (id: number, payload: PushPayload) => {
	sent.push({ userId: id, payload });
};

describe.skipIf(!dbUp)('market intel (database)', () => {
	beforeAll(async () => {
		const made = await db
			.insert(users)
			.values([
				{ email: `vitest-mi-${RUN}@example.invalid`, passwordHash: 'x', displayName: `Vitest.Mi${RUN}` },
				{ email: `vitest-mi2-${RUN}@example.invalid`, passwordHash: 'x', displayName: `Vitest.Mi2${RUN}` }
			])
			.returning({ id: users.id });
		[userId, otherUserId] = made.map((m) => m.id);
	});

	afterAll(async () => {
		if (!dbUp) return;
		await db.delete(announcements).where(eq(announcements.nseSymbol, SYM));
		await db.delete(insiderTrades).where(eq(insiderTrades.nseSymbol, SYM));
		await db.delete(sastDisclosures).where(eq(sastDisclosures.nseSymbol, SYM));
		await db.delete(corporateActions).where(eq(corporateActions.nseSymbol, SYM));
		await db.delete(shareholdingSnapshots).where(eq(shareholdingSnapshots.nseSymbol, SYM));
		await db.delete(symbolRefresh).where(like(symbolRefresh.symbol, '2041-%'));
		await db.delete(symbolRefresh).where(gte(symbolRefresh.refreshedAt, new Date('2040-01-01T00:00:00Z'))); // throttle rows stamped by the test clock
		await db.delete(symbolRefresh).where(eq(symbolRefresh.symbol, SYM));
		await db.delete(users).where(inArray(users.id, [userId, otherUserId])); // cascades rules, sections, keywords
	});

	describe('resumable feed filling', () => {
		const calls: string[] = [];
		const fakes = (over: Partial<MarketIntelDeps> = {}): Partial<MarketIntelDeps> => ({
			now: () => NOW,
			// Never prune from a test clock: it would see every stored filing as old.
			prune: async () => 0,
			fetchAnnouncements: async (from, to) => {
				calls.push(`ann ${from}`);
				return [{ ...ann(`day-${from}`, 1, `Order win for day ${from}`), announcedAt: new Date(`${from}T05:00:00Z`) }];
			},
			fetchInsider: async () => [],
			fetchSast: async () => [],
			fetchActions: async () => [],
			...over
		});

		it('does a few days per run, never refetches a finished day, and tops up the recent two', async () => {
			const first = await runMarketIntel(fakes(), 60_000);
			// two recent days and three past days of the announcements feed
			expect(calls.filter((c) => c.startsWith('ann'))).toHaveLength(5);
			expect(first.newAnnouncements).toBe(5);

			calls.length = 0;
			const second = await runMarketIntel(fakes({ now: () => new Date(NOW.getTime() + 60_000) }), 60_000);
			// recent days are not due again after one minute; three more past days are
			expect(calls.filter((c) => c.startsWith('ann')).sort()).toEqual(
				[addDays(TODAY, -5), addDays(TODAY, -6), addDays(TODAY, -7)].map((d) => `ann ${d}`).sort()
			);
			expect(second.newAnnouncements).toBe(3);

			// after enough runs the whole backfill window is covered, once each
			for (let i = 0; i < 6; i++) await runMarketIntel(fakes({ now: () => new Date(NOW.getTime() + (2 + i) * 60_000) }), 60_000);
			calls.length = 0;
			await runMarketIntel(fakes({ now: () => new Date(NOW.getTime() + 20 * 60_000) }), 60_000);
			// only today and yesterday come back (10 minutes later); the past is finished
			expect(calls.filter((c) => c.startsWith('ann')).sort()).toEqual([`ann ${TODAY}`, `ann ${addDays(TODAY, -1)}`].sort());
			const stored = await db.select().from(announcements).where(like(announcements.dedupeKey, `vitest-mi:${RUN}:day-%`));
			expect(stored).toHaveLength(BACKFILL_DAYS.ann);
		});

		it('reports a failing feed, keeps going, and retries it later', async () => {
			const failing = fakes({
				now: () => new Date('2041-05-20T10:00:00Z'),
				fetchAnnouncements: async () => {
					throw new Error('NSE announcements failed (HTTP 503)');
				},
				fetchSast: async () => [
					{
						dedupeKey: `vitest-mi:${RUN}:sast`,
						nseSymbol: SYM,
						companyName: 'Vitest Market Ltd',
						acquirerName: 'Some Fund',
						action: 'Acquisition',
						securityType: 'Equity',
						mode: 'Open Market',
						regulation: 'Reg29(2)',
						isPromoter: false,
						sharesAcquired: 10,
						sharesSold: null,
						sharesAfter: 10,
						pctAcquired: 1,
						pctSold: null,
						pctAfter: 5,
						periodText: '',
						disclosedAt: new Date('2026-03-03T10:00:00Z'),
						sourceUrl: null
					}
				]
			});
			const r = await runMarketIntel(failing, 60_000);
			expect(r.errors.length).toBeGreaterThan(0);
			expect(r.errors[0]).toContain('503');
			expect(r.newSast).toBeGreaterThan(0);
			await db.delete(symbolRefresh).where(like(symbolRefresh.symbol, '2041-05-%'));
			await db.delete(symbolRefresh).where(like(symbolRefresh.symbol, '2041-04-%'));
		});

		it('stops starting new units when the time budget is spent', async () => {
			const r = await runMarketIntel(fakes({ now: () => new Date('2041-08-01T10:00:00Z') }), 0);
			expect(r.unitsDone).toBe(0);
			await db.delete(symbolRefresh).where(like(symbolRefresh.symbol, '2041-07-%'));
			await db.delete(symbolRefresh).where(like(symbolRefresh.symbol, '2041-08-%'));
		});

		it('loads a company history once a day', async () => {
			let n = 0;
			const deps = {
				now: () => NOW,
				prune: async () => 0,
				fetchSymbolActions: async () => (n++, []),
				fetchSymbolInsider: async () => [trade('company-trade', { personName: 'Company History Person', personCategory: 'Employees/Designated Employees' })],
				fetchSymbolSast: async () => []
			};
			const a = await refreshCompanyFilings(SYM, deps);
			const b = await refreshCompanyFilings(SYM, deps);
			expect(a.refreshed).toBe(true);
			expect(b.refreshed).toBe(false);
			expect(n).toBe(1);
			expect((await store.companyHoldingFilings(SYM)).trades.some((t) => t.dedupeKey.endsWith('company-trade'))).toBe(true);
		});
	});

	describe('feed filters', () => {
		beforeAll(async () => {
			await store.saveFeedAnnouncements([
				ann('a1', 2, 'Bagging of orders', 'The company received a work order worth Rs 50 crore'),
				ann('a2', 30, 'Resignation of director', 'Mr X has resigned'),
				ann('a3', 50, 'Credit rating', 'CRISIL reaffirmed the rating'),
				ann('a4', 3, 'Trading window closure', 'routine paperwork')
			]);
		});

		const run = (qs: string) => store.listFeed(parseFeedFilters(new URLSearchParams(`company=${SYM}&${qs}`)));

		it('finds order wins by preset scan and keeps the rest out', async () => {
			expect(presetScan('order_win')).not.toBeNull();
			const { items } = await run('scan=order_win');
			expect(items.map((i) => i.subject)).toEqual(['Bagging of orders']);
		});

		it('filters by keyword, tag and date, case-insensitively', async () => {
			expect((await run('q=RESIGNED')).items.map((i) => i.subject)).toEqual(['Resignation of director']);
			expect((await run('tag=rating')).items.map((i) => i.subject)).toEqual(['Credit rating']);
			const day = new Date(Date.now() - 2 * 3600_000).toLocaleDateString('sv-SE', { timeZone: 'Asia/Kolkata' });
			const same = (await run(`from=${day}&to=${day}`)).items.map((i) => i.subject);
			expect(same).toContain('Bagging of orders');
			expect(same).not.toContain('Credit rating');
		});

		it('matches a company by ticker prefix or name and treats % and _ as plain characters', async () => {
			expect((await store.listFeed(parseFeedFilters(new URLSearchParams(`company=${SYM.slice(0, 6)}`)))).items.length).toBeGreaterThan(0);
			expect((await store.listFeed(parseFeedFilters(new URLSearchParams('company=%25')))).items).toHaveLength(0);
		});

		it('pages without a total count', async () => {
			const page1 = await run('page=1');
			expect(page1.items.length).toBeGreaterThanOrEqual(4);
			expect(page1.hasMore).toBe(false);
			expect((await run('page=2')).items).toHaveLength(0);
		});

		it('ranks a word used often this week as trending', async () => {
			await store.saveFeedAnnouncements(
				Array.from({ length: 60 }, (_, n) => n + 1).map((i) => ({ ...ann(`trend${i}`, i, 'Update', `Notice about zzquorbit financing number ${i}`) }))
			);
			const words = await store.trendingWords(new Date(), 400);
			expect(words.find((w) => w.word === 'zzquorbit')?.current).toBe(60);
		});
	});

	describe('saved keywords', () => {
		it('saves per person, ignores a duplicate by case, and deletes only the owners', async () => {
			expect(await store.addKeyword(userId, 'Slump Sale')).toBe(true);
			expect(await store.addKeyword(userId, 'slump sale')).toBe(false);
			expect(await store.addKeyword(otherUserId, 'slump sale')).toBe(true);
			const [mine] = await store.listKeywords(userId);
			await store.removeKeyword(otherUserId, mine.id);
			expect(await store.listKeywords(userId)).toHaveLength(1);
			await store.removeKeyword(userId, mine.id);
			expect(await store.listKeywords(userId)).toHaveLength(0);
		});
	});

	describe('insider trades', () => {
		beforeAll(async () => {
			await store.saveInsiderTrades([
				trade('t1'),
				trade('t2', { personName: 'Vikram Shah', personCategory: 'Director', txnType: 'Sell', value: 90_000_000, quantity: 5000, broadcastAt: new Date('2026-03-04T10:00:00Z') }),
				trade('t3', { personName: 'Ravi Menon', personCategory: 'Director', txnType: 'Pledge', value: 0, quantity: 100, broadcastAt: new Date('2026-03-05T10:00:00Z') })
			]);
		});

		const list = (qs: string) => store.listInsiderTrades(parseInsiderFilters(new URLSearchParams(`company=${SYM}&${qs}`)));

		it('filters by side, category, value and shareholder name', async () => {
			expect((await list('side=sell')).items.map((i) => i.personName)).toEqual(['Vikram Shah']);
			expect((await list('side=pledge')).items.map((i) => i.personName)).toEqual(['Ravi Menon']);
			expect((await list('category=Promoters')).items.map((i) => i.personName)).toEqual(['Asha Rao']);
			expect((await list('minLakh=500')).items.map((i) => i.personName)).toEqual(['Vikram Shah']);
			expect((await list('person=menon')).items).toHaveLength(1);
		});

		it('stores a repeated filing once', async () => {
			expect(await store.saveInsiderTrades([trade('t1')])).toBe(0);
		});
	});

	describe('price alerts', () => {
		const prices = (map: Record<string, number>) => ({
			storedCloses: async (symbols: string[]) => new Map(symbols.filter((s) => s in map).map((s) => [s, map[s]] as const)),
			liveQuotes: async () => new Map<string, number>(),
			marketOpen: () => false
		});

		it('fires a level alert once, leaves the others, and can be turned on again', async () => {
			const above = await store.addPriceRule(userId, 'Vitest', { nseSymbol: SYM, kind: 'above', threshold: 100, basePrice: 90 });
			const below = await store.addPriceRule(userId, 'Vitest', { nseSymbol: SYM, kind: 'below', threshold: 50, basePrice: 90 });
			const pct = await store.addPriceRule(userId, 'Vitest', { nseSymbol: SYM, kind: 'pct_up', threshold: 10, basePrice: 90 });
			sent.length = 0;
			const summary = emptyAlertSummary();
			await runPriceAlerts(notify, NOW, summary, prices({ [SYM]: 101 }));
			expect(summary.priceAlertsSent).toBe(2); // above 100, and 10% up from 90 = 99
			expect(sent.map((s) => s.payload.tag).sort()).toEqual([`price-alert-${above}`, `price-alert-${pct}`].sort());
			expect(sent[0].userId).toBe(userId);

			const again = emptyAlertSummary();
			await runPriceAlerts(notify, NOW, again, prices({ [SYM]: 101 }));
			expect(again.priceAlertsSent).toBe(0);

			const rules = await store.listPriceRules(userId);
			expect(rules.find((r) => r.id === below)?.active).toBe(true);
			expect(rules.find((r) => r.id === above)?.active).toBe(false);
			expect(rules.find((r) => r.id === above)?.triggeredPrice).toBe(101);

			await store.rearmPriceRule(userId, above, 101);
			expect((await store.listPriceRules(userId)).find((r) => r.id === above)?.active).toBe(true);
			await db.delete(priceAlertRules).where(eq(priceAlertRules.userId, userId));
		});

		it('uses the live quote while the market is open, and the stored close if the broker fails', async () => {
			const id = await store.addPriceRule(userId, 'Vitest', { nseSymbol: SYM, kind: 'below', threshold: 80, basePrice: 90 });
			sent.length = 0;
			const open = { ...prices({ [SYM]: 90 }), marketOpen: () => true, liveQuotes: async () => new Map([[SYM, 79]]) };
			const live = emptyAlertSummary();
			await runPriceAlerts(notify, NOW, live, open);
			expect(live.priceAlertsSent).toBe(1);
			expect(sent[0].payload.body).toContain('fell to or below');

			await store.rearmPriceRule(userId, id, null);
			const broken = { ...prices({ [SYM]: 75 }), marketOpen: () => true, liveQuotes: async () => { throw new Error('broker down'); } };
			const fallback = emptyAlertSummary();
			await runPriceAlerts(notify, NOW, fallback, broken);
			expect(fallback.priceAlertsSent).toBe(1);
			expect(fallback.errors[0]).toContain('broker down');
			await db.delete(priceAlertRules).where(eq(priceAlertRules.userId, userId));
		});

		it('does nothing for a symbol that has no price', async () => {
			await store.addPriceRule(userId, 'Vitest', { nseSymbol: SYM, kind: 'above', threshold: 1, basePrice: null });
			const s = emptyAlertSummary();
			await runPriceAlerts(notify, NOW, s, prices({}));
			expect(s.priceAlertsSent).toBe(0);
			await db.delete(priceAlertRules).where(eq(priceAlertRules.userId, userId));
		});
	});

	describe('shareholding change alerts', () => {
		it('tells the people who track the company and set a threshold, once per quarter', async () => {
			await db.insert(trackedCompanies).values([
				{ userId, nseSymbol: SYM, companyName: 'Vitest' },
				{ userId: otherUserId, nseSymbol: SYM, companyName: 'Vitest' }
			]);
			await store.saveHoldingSettings(userId, { promoterPp: 1, fiiPp: null, diiPp: 5 });
			// otherUserId tracks it but set no threshold
			await db.insert(shareholdingSnapshots).values({
				nseSymbol: SYM, period: 'Dec 2026', promoters: 50, fiis: 20, diis: 10, public: 20,
				prevPeriod: 'Sep 2026', prevPromoters: 52, prevFiis: 10, prevDiis: 9, prevPublic: 29
			});
			sent.length = 0;
			const summary = emptyAlertSummary();
			await runHoldingAlerts([SYM], notify, summary);
			expect(summary.holdingAlertsSent).toBe(1);
			expect(sent).toHaveLength(1);
			expect(sent[0].userId).toBe(userId);
			expect(sent[0].payload.body).toContain('Promoter 52.00% to 50.00%');
			expect(sent[0].payload.body).not.toContain('FII'); // switched off
			expect(sent[0].payload.body).not.toContain('DII'); // moved 1 point, threshold 5

			await runHoldingAlerts([SYM], notify, summary);
			expect(summary.holdingAlertsSent).toBe(1);
			await db.delete(holdingAlertDeliveries).where(eq(holdingAlertDeliveries.userId, userId));
			await db.delete(holdingAlertSettings).where(eq(holdingAlertSettings.userId, userId));
			await db.delete(trackedCompanies).where(inArray(trackedCompanies.userId, [userId, otherUserId]));
		});
	});

	describe('list sections', () => {
		it('keeps names unique per person, scopes to the owner, and stores flags', async () => {
			const id = await store.createSection(userId, 'Defence');
			expect(id).not.toBeNull();
			expect(await store.createSection(userId, 'defence')).toBeNull();
			expect(await store.createSection(otherUserId, 'Defence')).not.toBeNull();
			expect(await store.ownsSection(otherUserId, id!)).toBe(false);

			await store.addSectionItem(id!, SYM, 'Vitest Market Ltd');
			await store.setSectionFlag(id!, SYM, { color: 'red', label: 'Check pledge' });
			const [section] = await store.listSections(userId);
			expect(section.items).toEqual([{ nseSymbol: SYM, companyName: 'Vitest Market Ltd', flagColor: 'red', flagLabel: 'Check pledge' }]);
			expect((await store.flagsFor(userId, [SYM])).get(SYM)?.section).toBe('Defence');
			expect((await store.flagsFor(otherUserId, [SYM])).size).toBe(0);

			expect(await store.renameSection(userId, id!, 'Defence and aerospace')).toBe(true);
			await store.deleteSection(otherUserId, id!); // not theirs: nothing happens
			expect(await store.listSections(userId)).toHaveLength(1);
			await store.deleteSection(userId, id!);
			expect(await store.listSections(userId)).toHaveLength(0);
		});

		it('adds section companies to the results calendar symbols', async () => {
			const { calendarSymbols } = await import('../src/lib/valuation/server/intelStore');
			const id = await store.createSection(userId, 'Calendar');
			await store.addSectionItem(id!, SYM, 'Vitest Market Ltd');
			expect(await calendarSymbols()).toContain(SYM);
		});
	});

	describe('the one-minute poller', () => {
		it('sends a price alert through the same channels and survives the market feed failing', async () => {
			const endpoint = `https://push.example/${RUN}/mi`;
			await db.insert(pushSubscriptions).values({ userId, endpoint, p256dh: 'p', auth: 'a' });
			await store.addPriceRule(userId, 'Vitest', { nseSymbol: SYM, kind: 'above', threshold: 10, basePrice: 5 });
			const pushed: string[] = [];
			const result = await runAnnouncementCheck({
				fetchAnnouncements: async () => [],
				summariesOn: () => false,
				pushOn: () => true,
				telegramOn: () => false,
				send: async (target, payload) => {
					pushed.push(`${target.endpoint}|${payload}`);
				},
				now: () => new Date(),
				alerts: { storedCloses: async () => new Map([[SYM, 12]]), liveQuotes: async () => new Map(), marketOpen: () => false },
				intel: { fetchMeetings: async () => [], fetchDeals: async () => [], fetchShareholding: async () => null },
				marketIntel: async () => {
					throw new Error('NSE unreachable');
				}
			});
			expect(result.alerts.priceAlertsSent).toBeGreaterThanOrEqual(1);
			expect(pushed.some((p) => p.startsWith(endpoint))).toBe(true);
			expect(result.errors.some((e) => e.includes('NSE unreachable'))).toBe(true);
			await db.delete(priceAlertRules).where(and(eq(priceAlertRules.userId, userId)));
		});
	});
});
