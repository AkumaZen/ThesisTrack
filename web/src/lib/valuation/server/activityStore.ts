import { and, desc, eq, lt, sql } from 'drizzle-orm';
import { db } from './db';
import { activityLog } from './db/schema';
import type { ActivityEntry } from '$lib/activity';

/** A database handle or an open transaction (both expose the same query builder). */
export type Tx = Pick<typeof db, 'select' | 'insert' | 'update' | 'delete' | 'execute'>;

/** Records one thing a teammate did. With `refId`, an existing entry of the same kind and ref is
 *  updated instead (a continuing edit session stays one line in the feed). */
export async function logActivity(
	tx: Tx,
	entry: { actor: string; kind: string; symbol?: string | null; summary: string; refId?: number },
	at = Date.now()
) {
	if (entry.refId !== undefined) {
		const updated = await tx
			.update(activityLog)
			.set({ at, summary: entry.summary })
			.where(and(eq(activityLog.kind, entry.kind), eq(activityLog.refId, entry.refId)))
			.returning({ id: activityLog.id });
		if (updated.length) return;
	}
	await tx.insert(activityLog).values({
		at,
		actor: entry.actor,
		kind: entry.kind,
		symbol: entry.symbol ?? null,
		summary: entry.summary,
		refId: entry.refId ?? null
	});
}

/** Newest first. `before` (a timestamp) pages further back. */
export async function listActivity(opts: {
	limit: number;
	before?: number;
	symbol?: string;
	excludeActor?: string;
}): Promise<ActivityEntry[]> {
	const where = [];
	if (opts.before !== undefined) where.push(lt(activityLog.at, opts.before));
	if (opts.symbol) where.push(eq(activityLog.symbol, opts.symbol.toUpperCase()));
	if (opts.excludeActor) where.push(sql`${activityLog.actor} <> ${opts.excludeActor}`);
	const rows = await db
		.select()
		.from(activityLog)
		.where(where.length ? and(...where) : undefined)
		.orderBy(desc(activityLog.at), desc(activityLog.id))
		.limit(opts.limit);
	return rows.map((r) => ({
		id: r.id,
		at: r.at,
		actor: r.actor,
		kind: r.kind,
		symbol: r.symbol,
		summary: r.summary
	}));
}
