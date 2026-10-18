import { and, asc, desc, eq, gt, inArray, isNull, lt, notExists, sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import {
	announcementDeliveries,
	announcements,
	pushSubscriptions,
	trackedCompanies
} from '$lib/server/db/valuationSchema';
import { MAX_SUMMARY_ATTEMPTS, type ParsedAnnouncement } from '../announcements';
import type { PushOutcome, PushTarget } from '$lib/server/webPush';

export type AnnouncementRow = typeof announcements.$inferSelect;

const DAY_MS = 24 * 3600_000;

// ---- tracked companies ----

export const listTracked = (userId: number) =>
	db
		.select({
			nseSymbol: trackedCompanies.nseSymbol,
			companyName: trackedCompanies.companyName,
			createdAt: trackedCompanies.createdAt
		})
		.from(trackedCompanies)
		.where(eq(trackedCompanies.userId, userId))
		.orderBy(asc(trackedCompanies.companyName));

export async function addTracked(userId: number, nseSymbol: string, companyName: string) {
	await db.insert(trackedCompanies).values({ userId, nseSymbol, companyName }).onConflictDoNothing();
}

export async function removeTracked(userId: number, nseSymbol: string) {
	await db
		.delete(trackedCompanies)
		.where(and(eq(trackedCompanies.userId, userId), eq(trackedCompanies.nseSymbol, nseSymbol)));
}

export async function isTracked(userId: number, nseSymbol: string): Promise<boolean> {
	const rows = await db
		.select({ id: trackedCompanies.id })
		.from(trackedCompanies)
		.where(and(eq(trackedCompanies.userId, userId), eq(trackedCompanies.nseSymbol, nseSymbol)))
		.limit(1);
	return rows.length > 0;
}

/** Every symbol anybody tracks, once. */
export async function distinctTrackedSymbols(): Promise<string[]> {
	const rows = await db.selectDistinct({ symbol: trackedCompanies.nseSymbol }).from(trackedCompanies);
	return rows.map((r) => r.symbol);
}

// ---- announcements ----

/** Stores announcements not seen before (by dedupe key); returns how many were new. */
export async function saveAnnouncements(rows: ParsedAnnouncement[]): Promise<number> {
	if (!rows.length) return 0;
	const inserted = await db
		.insert(announcements)
		.values(
			rows.map((r) => ({
				dedupeKey: r.dedupeKey,
				nseSymbol: r.nseSymbol,
				companyName: r.companyName,
				subject: r.subject,
				details: r.details,
				announcedAt: r.announcedAt,
				pdfUrl: r.pdfUrl
			}))
		)
		.onConflictDoNothing({ target: announcements.dedupeKey })
		.returning({ id: announcements.id });
	return inserted.length;
}

export const listAnnouncements = (nseSymbol: string, limit = 50) =>
	db
		.select()
		.from(announcements)
		.where(eq(announcements.nseSymbol, nseSymbol))
		.orderBy(desc(announcements.announcedAt))
		.limit(limit);

/** Recent announcements of tracked companies that still lack a summary (newest first). */
export function listToSummarise(symbols: string[], now: Date, limit: number): Promise<AnnouncementRow[]> {
	if (!symbols.length) return Promise.resolve([]);
	return db
		.select()
		.from(announcements)
		.where(
			and(
				inArray(announcements.nseSymbol, symbols),
				isNull(announcements.summary),
				lt(announcements.summaryAttempts, MAX_SUMMARY_ATTEMPTS),
				gt(announcements.announcedAt, new Date(now.getTime() - DAY_MS))
			)
		)
		.orderBy(desc(announcements.announcedAt))
		.limit(limit);
}

export async function saveSummary(id: number, summary: string) {
	await db
		.update(announcements)
		.set({ summary, summarisedAt: new Date(), summaryAttempts: sql`${announcements.summaryAttempts} + 1` })
		.where(eq(announcements.id, id));
}

export async function noteSummaryFailure(id: number) {
	await db
		.update(announcements)
		.set({ summaryAttempts: sql`${announcements.summaryAttempts} + 1` })
		.where(eq(announcements.id, id));
}

// ---- deliveries ----

export interface PendingDelivery {
	userId: number;
	trackedSince: Date;
	announcement: AnnouncementRow;
}

/** (person, announcement) pairs not yet pushed: published after the person started tracking and
 *  within the last 24 hours. Oldest first so alerts arrive in order. */
export function listPendingDeliveries(now: Date): Promise<PendingDelivery[]> {
	return db
		.select({
			userId: trackedCompanies.userId,
			trackedSince: trackedCompanies.createdAt,
			announcement: announcements
		})
		.from(announcements)
		.innerJoin(trackedCompanies, eq(trackedCompanies.nseSymbol, announcements.nseSymbol))
		.where(
			and(
				gt(announcements.announcedAt, trackedCompanies.createdAt),
				gt(announcements.announcedAt, new Date(now.getTime() - DAY_MS)),
				notExists(
					db
						.select({ one: sql`1` })
						.from(announcementDeliveries)
						.where(
							and(
								eq(announcementDeliveries.userId, trackedCompanies.userId),
								eq(announcementDeliveries.announcementId, announcements.id)
							)
						)
				)
			)
		)
		.orderBy(asc(announcements.announcedAt))
		.limit(200);
}

/** True only for the caller that inserted the row, so overlapping runs never double-notify. */
export async function claimDelivery(userId: number, announcementId: number): Promise<boolean> {
	const rows = await db
		.insert(announcementDeliveries)
		.values({ userId, announcementId })
		.onConflictDoNothing()
		.returning({ userId: announcementDeliveries.userId });
	return rows.length > 0;
}

// ---- push subscriptions ----

export const listSubscriptions = (userId: number): Promise<PushTarget[]> =>
	db
		.select({
			id: pushSubscriptions.id,
			endpoint: pushSubscriptions.endpoint,
			p256dh: pushSubscriptions.p256dh,
			auth: pushSubscriptions.auth
		})
		.from(pushSubscriptions)
		.where(eq(pushSubscriptions.userId, userId));

/** A device (endpoint) belongs to one person: signing in as someone else on it moves it. */
export async function saveSubscription(userId: number, s: { endpoint: string; p256dh: string; auth: string }) {
	await db
		.insert(pushSubscriptions)
		.values({ userId, ...s })
		.onConflictDoUpdate({ target: pushSubscriptions.endpoint, set: { userId, p256dh: s.p256dh, auth: s.auth } });
}

export async function removeSubscription(userId: number, endpoint: string) {
	await db
		.delete(pushSubscriptions)
		.where(and(eq(pushSubscriptions.userId, userId), eq(pushSubscriptions.endpoint, endpoint)));
}

/** Records the result of a send: deletes dead subscriptions and stamps the others. */
export async function recordPushOutcome(o: PushOutcome) {
	if (o.gone.length) await db.delete(pushSubscriptions).where(inArray(pushSubscriptions.id, o.gone));
	if (o.succeededIds.length)
		await db.update(pushSubscriptions).set({ lastSuccessAt: new Date() }).where(inArray(pushSubscriptions.id, o.succeededIds));
	if (o.failedIds.length)
		await db.update(pushSubscriptions).set({ lastFailureAt: new Date() }).where(inArray(pushSubscriptions.id, o.failedIds));
}
