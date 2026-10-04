import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { userPrefs } from '$lib/server/db/valuationSchema';
import { mergePrefs, sanitizePrefs, type UserPrefs } from '$lib/valuation/prefs';

export async function getPrefs(userId: number): Promise<UserPrefs> {
	const [row] = await db.select().from(userPrefs).where(eq(userPrefs.userId, userId));
	return sanitizePrefs(row?.prefs);
}

/** Merges `patch` into the stored preferences under a row lock, so two tabs saving different
 *  sections at once both land. Returns the stored result. */
export async function updatePrefs(userId: number, patch: unknown): Promise<UserPrefs> {
	return db.transaction(async (tx) => {
		const now = Date.now();
		await tx.insert(userPrefs).values({ userId, prefs: {}, updatedAt: now }).onConflictDoNothing();
		const [row] = await tx
			.select()
			.from(userPrefs)
			.where(eq(userPrefs.userId, userId))
			.for('update');
		const next = mergePrefs(sanitizePrefs(row.prefs), patch);
		await tx
			.update(userPrefs)
			.set({ prefs: next, updatedAt: now })
			.where(eq(userPrefs.userId, userId));
		return next;
	});
}

/** Records a visit to the watchlist and returns the previous one (null on a first visit). */
export async function recordWatchlistVisit(userId: number): Promise<number | null> {
	const before = await getPrefs(userId);
	await updatePrefs(userId, { lastWatchlistVisit: Date.now() });
	return before.lastWatchlistVisit;
}
