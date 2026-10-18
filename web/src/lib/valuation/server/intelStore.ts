import { and, asc, desc, eq, gte, inArray, isNull, notExists, sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import {
	announcements,
	boardMeetings,
	dealDeliveries,
	marketDeals,
	savedValuations,
	shareholdingSnapshots,
	symbolRefresh,
	trackedCompanies,
	userNotificationSettings
} from '$lib/server/db/valuationSchema';
import { watchlistSectionItems } from '$lib/server/db/marketIntelSchema';
import { classifyAnnouncement } from '../announcementTags';
import { isDue, type ParsedMeeting } from '../boardMeetings';
import type { ParsedDeal } from '../deals';
import type { ShareholdingParsed } from './shareholding';

// Storage for the results calendar, the refresh throttle and per-person notification settings.

// ---- refresh throttle ----

/**
 * Picks up to `limit` symbols that are due for `kind` (never refreshed first, then oldest) and claims
 * them in one conditional upsert, so two overlapping poller runs never fetch the same symbol twice.
 * A claimed symbol counts as refreshed straight away; call markRefreshFailed if the fetch fails.
 */
export async function claimDueSymbols(
	kind: string,
	symbols: string[],
	now: Date,
	intervalMs: number,
	limit: number,
	retryMs = 15 * 60_000
): Promise<string[]> {
	if (!symbols.length || limit <= 0) return [];
	const rows = await db
		.select()
		.from(symbolRefresh)
		.where(and(eq(symbolRefresh.kind, kind), inArray(symbolRefresh.symbol, symbols)));
	const known = new Map(rows.map((r) => [r.symbol, r]));
	const due = symbols
		.filter((s) => isDue(known.get(s), now, intervalMs, retryMs))
		.sort((a, b) => (known.get(a)?.refreshedAt.getTime() ?? 0) - (known.get(b)?.refreshedAt.getTime() ?? 0))
		.slice(0, limit);
	if (!due.length) return [];
	const goodCutoff = new Date(now.getTime() - intervalMs).toISOString();
	const retryCutoff = new Date(now.getTime() - retryMs).toISOString();
	const claimed = await db
		.insert(symbolRefresh)
		.values(due.map((symbol) => ({ kind, symbol, refreshedAt: now, ok: true })))
		.onConflictDoUpdate({
			target: [symbolRefresh.kind, symbolRefresh.symbol],
			set: { refreshedAt: now, ok: true },
			setWhere: sql`(${symbolRefresh.ok} and ${symbolRefresh.refreshedAt} <= ${goodCutoff}::timestamptz) or (not ${symbolRefresh.ok} and ${symbolRefresh.refreshedAt} <= ${retryCutoff}::timestamptz)`
		})
		.returning({ symbol: symbolRefresh.symbol });
	return claimed.map((c) => c.symbol);
}

export async function markRefreshFailed(kind: string, symbol: string) {
	await db
		.update(symbolRefresh)
		.set({ ok: false })
		.where(and(eq(symbolRefresh.kind, kind), eq(symbolRefresh.symbol, symbol)));
}

// ---- who to watch ----

/** Companies on the shared watchlist that NSE can answer for (BSE-only numeric codes are skipped). */
export async function watchlistNseSymbols(): Promise<string[]> {
	const rows = await db.select({ symbol: savedValuations.symbol }).from(savedValuations);
	return rows.map((r) => r.symbol.toUpperCase()).filter((s) => /^[A-Z0-9&-]{1,20}$/.test(s) && !/^\d+$/.test(s));
}

// ---- board meetings ----

/** Stores meetings; one row per company/day/kind. The exchange's wording replaces one we parsed from text. */
export async function saveMeetings(rows: ParsedMeeting[]) {
	if (!rows.length) return;
	await db
		.insert(boardMeetings)
		.values(
			rows.map((r) => ({
				dedupeKey: r.dedupeKey,
				nseSymbol: r.nseSymbol,
				companyName: r.companyName,
				meetingDate: r.meetingDate,
				purpose: r.purpose,
				isResults: r.isResults,
				source: r.source
			}))
		)
		.onConflictDoUpdate({
			target: boardMeetings.dedupeKey,
			set: { purpose: sql`excluded.purpose`, companyName: sql`excluded.company_name`, source: sql`excluded.source` },
			setWhere: sql`excluded.source = 'nse'`
		});
}

export const listUpcomingMeetings = (symbols: string[], today: string) =>
	symbols.length
		? db
				.select()
				.from(boardMeetings)
				.where(and(inArray(boardMeetings.nseSymbol, symbols), gte(boardMeetings.meetingDate, today)))
				.orderBy(asc(boardMeetings.meetingDate), asc(boardMeetings.nseSymbol))
		: Promise.resolve([]);

/** Board-meeting intimations we already stored, for reading meeting dates out of their text. */
export const listRecentIntimations = (symbols: string[], since: Date) =>
	symbols.length
		? db
				.select({
					nseSymbol: announcements.nseSymbol,
					companyName: announcements.companyName,
					subject: announcements.subject,
					details: announcements.details,
					announcedAt: announcements.announcedAt
				})
				.from(announcements)
				.where(
					and(
						inArray(announcements.nseSymbol, symbols),
						eq(announcements.tag, 'board_meeting'),
						gte(announcements.announcedAt, since)
					)
				)
		: Promise.resolve([]);

// ---- announcement tags ----

/** Tags older rows that were stored before tagging existed; a few hundred per run until none are left. */
export async function tagUntagged(limit = 500): Promise<number> {
	const rows = await db
		.select({ id: announcements.id, subject: announcements.subject, details: announcements.details })
		.from(announcements)
		.where(isNull(announcements.tag))
		.limit(limit);
	for (const r of rows) {
		await db
			.update(announcements)
			.set({ tag: classifyAnnouncement(r.subject, r.details) })
			.where(eq(announcements.id, r.id));
	}
	return rows.length;
}

// ---- notification settings ----

export async function getOnlyImportant(userId: number): Promise<boolean> {
	const [row] = await db
		.select({ v: userNotificationSettings.onlyImportant })
		.from(userNotificationSettings)
		.where(eq(userNotificationSettings.userId, userId));
	return row?.v ?? false;
}

export async function setOnlyImportant(userId: number, onlyImportant: boolean) {
	await db
		.insert(userNotificationSettings)
		.values({ userId, onlyImportant })
		.onConflictDoUpdate({
			target: userNotificationSettings.userId,
			set: { onlyImportant, updatedAt: new Date() }
		});
}

/** Symbols to build the calendar for: everything tracked by anybody, the watchlist and anyone's list sections. */
export async function calendarSymbols(): Promise<string[]> {
	const tracked = await db.selectDistinct({ symbol: trackedCompanies.nseSymbol }).from(trackedCompanies);
	const sectioned = await db.selectDistinct({ symbol: watchlistSectionItems.nseSymbol }).from(watchlistSectionItems);
	const nse = (s: string) => /^[A-Z0-9&-]{1,20}$/.test(s) && !/^\d+$/.test(s);
	return [...new Set([...tracked.map((t) => t.symbol), ...(await watchlistNseSymbols()), ...sectioned.map((t) => t.symbol).filter(nse)])];
}

// ---- bulk / block deals ----

/** Stores deals of the companies we watch; returns how many were new (by dedupe key). */
export async function saveDeals(rows: ParsedDeal[], symbols: string[]): Promise<number> {
	const watched = new Set(symbols);
	const mine = rows.filter((r) => watched.has(r.nseSymbol));
	if (!mine.length) return 0;
	const inserted = await db
		.insert(marketDeals)
		.values(
			mine.map((r) => ({
				dedupeKey: r.dedupeKey,
				kind: r.kind,
				nseSymbol: r.nseSymbol,
				companyName: r.companyName,
				dealDate: r.dealDate,
				clientName: r.clientName,
				side: r.side,
				quantity: r.quantity,
				price: r.price
			}))
		)
		.onConflictDoNothing({ target: marketDeals.dedupeKey })
		.returning({ id: marketDeals.id });
	return inserted.length;
}

export const listDeals = (symbol: string, sinceDay: string) =>
	db
		.select()
		.from(marketDeals)
		.where(and(eq(marketDeals.nseSymbol, symbol), gte(marketDeals.dealDate, sinceDay)))
		.orderBy(desc(marketDeals.dealDate), desc(marketDeals.id));

export type DealRow = typeof marketDeals.$inferSelect;

export interface PendingDealDelivery {
	userId: number;
	trackedSince: Date;
	deal: DealRow;
}

/** (person, deal) pairs for tracked companies not yet delivered; recent deals only. */
export function listPendingDealDeliveries(sinceDay: string): Promise<PendingDealDelivery[]> {
	return db
		.select({ userId: trackedCompanies.userId, trackedSince: trackedCompanies.createdAt, deal: marketDeals })
		.from(marketDeals)
		.innerJoin(trackedCompanies, eq(trackedCompanies.nseSymbol, marketDeals.nseSymbol))
		.where(
			and(
				gte(marketDeals.dealDate, sinceDay),
				notExists(
					db
						.select({ one: sql`1` })
						.from(dealDeliveries)
						.where(and(eq(dealDeliveries.userId, trackedCompanies.userId), eq(dealDeliveries.dealId, marketDeals.id)))
				)
			)
		)
		.orderBy(asc(marketDeals.id))
		.limit(200);
}

/** True only for the caller that inserted the row (claim before send, as with announcements). */
export async function claimDealDelivery(userId: number, dealId: number): Promise<boolean> {
	const rows = await db
		.insert(dealDeliveries)
		.values({ userId, dealId })
		.onConflictDoNothing()
		.returning({ userId: dealDeliveries.userId });
	return rows.length > 0;
}

// ---- shareholding ----

export async function saveShareholding(symbol: string, s: ShareholdingParsed) {
	const values = { ...s, fetchedAt: new Date() };
	await db
		.insert(shareholdingSnapshots)
		.values({ nseSymbol: symbol, ...values })
		.onConflictDoUpdate({ target: shareholdingSnapshots.nseSymbol, set: values });
}

export async function getShareholding(symbol: string) {
	const [row] = await db.select().from(shareholdingSnapshots).where(eq(shareholdingSnapshots.nseSymbol, symbol));
	return row ?? null;
}
