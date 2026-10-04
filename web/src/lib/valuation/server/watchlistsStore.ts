import { and, asc, eq, sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { watchlistMembers, watchlists } from '$lib/server/db/valuationSchema';
import { logActivity } from './activityStore';
import { resolveCompanyName } from './companyNames';
import type { NamedWatchlist } from '$lib/valuation/watchlists';

export async function listWatchlists(): Promise<NamedWatchlist[]> {
	const [lists, members] = await Promise.all([
		db
			.select()
			.from(watchlists)
			.orderBy(asc(sql`lower(${watchlists.name})`)),
		db.select().from(watchlistMembers).orderBy(asc(watchlistMembers.addedAt))
	]);
	return lists.map((l) => ({
		id: l.id,
		name: l.name,
		createdBy: l.createdBy,
		createdAt: l.createdAt,
		symbols: members.filter((m) => m.watchlistId === l.id).map((m) => m.symbol)
	}));
}

/** Postgres unique_violation (23505). Drizzle wraps driver errors, so look at the cause too. */
export function isUniqueViolation(e: unknown): boolean {
	for (let err = e, depth = 0; err && depth < 4; depth++) {
		if (typeof err === 'object' && (err as { code?: string }).code === '23505') return true;
		err = (err as { cause?: unknown }).cause;
	}
	return false;
}

export type ListOutcome<T> =
	{ ok: true; value: T } | { ok: false; reason: 'duplicate' | 'not_found' | 'forbidden' };

export async function createWatchlist(
	name: string,
	by: string
): Promise<ListOutcome<NamedWatchlist>> {
	const now = Date.now();
	try {
		return await db.transaction(async (tx) => {
			const [row] = await tx
				.insert(watchlists)
				.values({ name: name.trim(), createdBy: by, createdAt: now })
				.returning();
			await logActivity(
				tx,
				{ actor: by, kind: 'watchlist', summary: `created the list "${row.name}"` },
				now
			);
			return { ok: true as const, value: { ...row, symbols: [] } };
		});
	} catch (e) {
		if (isUniqueViolation(e)) return { ok: false, reason: 'duplicate' };
		throw e;
	}
}

export async function renameWatchlist(
	id: number,
	name: string,
	by: string
): Promise<ListOutcome<null>> {
	try {
		return await db.transaction(async (tx) => {
			const [old] = await tx.select().from(watchlists).where(eq(watchlists.id, id)).for('update');
			if (!old) return { ok: false as const, reason: 'not_found' as const };
			await tx.update(watchlists).set({ name: name.trim() }).where(eq(watchlists.id, id));
			await logActivity(tx, {
				actor: by,
				kind: 'watchlist',
				summary: `renamed the list "${old.name}" to "${name.trim()}"`
			});
			return { ok: true as const, value: null };
		});
	} catch (e) {
		if (isUniqueViolation(e)) return { ok: false, reason: 'duplicate' };
		throw e;
	}
}

/** The creator or an admin may delete a list. Its companies stay on the main watchlist. */
export async function deleteWatchlist(
	id: number,
	by: string,
	isAdmin: boolean
): Promise<ListOutcome<null>> {
	return db.transaction(async (tx) => {
		const [old] = await tx.select().from(watchlists).where(eq(watchlists.id, id)).for('update');
		if (!old) return { ok: false, reason: 'not_found' };
		if (old.createdBy !== by && !isAdmin) return { ok: false, reason: 'forbidden' };
		await tx.delete(watchlists).where(eq(watchlists.id, id));
		await logActivity(tx, {
			actor: by,
			kind: 'watchlist',
			summary: `deleted the list "${old.name}"`
		});
		return { ok: true, value: null };
	});
}

export async function setMembership(
	id: number,
	symbol: string,
	member: boolean,
	by: string
): Promise<ListOutcome<null>> {
	const key = symbol.toUpperCase();
	const name = await resolveCompanyName(key);
	return db.transaction(async (tx) => {
		const [list] = await tx.select().from(watchlists).where(eq(watchlists.id, id));
		if (!list) return { ok: false, reason: 'not_found' };
		const changed = member
			? await tx
					.insert(watchlistMembers)
					.values({ watchlistId: id, symbol: key, addedBy: by, addedAt: Date.now() })
					.onConflictDoNothing()
					.returning()
			: await tx
					.delete(watchlistMembers)
					.where(and(eq(watchlistMembers.watchlistId, id), eq(watchlistMembers.symbol, key)))
					.returning();
		if (changed.length) {
			await logActivity(tx, {
				actor: by,
				kind: 'watchlist',
				symbol: key,
				summary: member ? `added ${name} to "${list.name}"` : `took ${name} off "${list.name}"`
			});
		}
		return { ok: true, value: null };
	});
}
