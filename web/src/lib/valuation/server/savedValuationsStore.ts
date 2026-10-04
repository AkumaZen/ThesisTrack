import { and, desc, eq, lt, sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { coverage, savedValuations, valuationStatus, valuationVersions } from '$lib/server/db/valuationSchema';
import { users } from '$lib/server/db/schema';
import { logActivity, type Tx } from './activityStore';
import { diffValuations } from '$lib/valuation/valuationDiff';
import type {
	RemovedValuation,
	SaveBody,
	SavedValuationMeta,
	SavedValuationRecord,
	ValuationContent,
	ValuationVersionInfo
} from '$lib/valuation/savedValuations';

/** Autosaves by the same person closer together than this are one editing session (one version). */
export const EDIT_SESSION_MS = 10 * 60 * 1000;
/** Removed valuations stay listed (and one click from restored) for this long. */
const REMOVED_LIST_DAYS = 30;

function toRecord(row: typeof savedValuations.$inferSelect): SavedValuationRecord {
	return {
		name: row.name,
		lastUpdated: row.lastUpdated,
		assumptions: row.assumptions as SavedValuationRecord['assumptions'],
		shares: row.shares,
		activeMethod: (row.activeMethod as SavedValuationRecord['activeMethod']) ?? undefined,
		activeScenario: (row.activeScenario as SavedValuationRecord['activeScenario']) ?? undefined,
		version: row.version,
		updatedBy: row.updatedBy
	};
}

function contentOf(v: Omit<SaveBody, 'baseVersion'>): ValuationContent {
	return {
		name: v.name,
		lastUpdated: v.lastUpdated,
		assumptions: v.assumptions,
		shares: v.shares,
		activeMethod: v.activeMethod,
		activeScenario: v.activeScenario
	};
}

export async function getSavedValuationRow(symbol: string): Promise<SavedValuationRecord | null> {
	const key = symbol.toUpperCase();
	const [row] = await db.select().from(savedValuations).where(eq(savedValuations.symbol, key));
	return row ? toRecord(row) : null;
}

/** The watchlist: every saved valuation with who saved it last, its review status and analyst. */
export async function listSavedValuationRows(): Promise<SavedValuationMeta[]> {
	const rows = await db
		.select({
			symbol: savedValuations.symbol,
			name: savedValuations.name,
			lastUpdated: savedValuations.lastUpdated,
			updatedBy: savedValuations.updatedBy,
			version: savedValuations.version,
			status: valuationStatus.status,
			statusAtVersion: valuationStatus.atVersion,
			coveredBy: users.displayName
		})
		.from(savedValuations)
		.leftJoin(valuationStatus, eq(valuationStatus.symbol, savedValuations.symbol))
		.leftJoin(coverage, eq(coverage.symbol, savedValuations.symbol))
		.leftJoin(users, eq(users.id, coverage.userId));
	return rows
		.map((r) => ({
			symbol: r.symbol,
			name: r.name,
			lastUpdated: r.lastUpdated,
			updatedBy: r.updatedBy,
			version: r.version,
			status: r.status ?? null,
			statusStale:
				r.status === 'approved' && r.statusAtVersion !== null && r.version > r.statusAtVersion,
			coveredBy: r.coveredBy ?? null
		}))
		.sort((a, b) => b.lastUpdated - a.lastUpdated);
}

export type SaveOutcome =
	| { ok: true; version: number; updatedBy: string | null }
	| { ok: false; current: SavedValuationRecord | null };

/** The next version number for a symbol: past every version it has ever had, so a company that
 *  was removed and added again never reuses an old number. */
const nextVersionSql = (key: string) =>
	sql`coalesce((select max(${valuationVersions.version}) from ${valuationVersions} where ${valuationVersions.symbol} = ${key}), 0) + 1`;

/**
 * Saves a valuation as `userName`. With `body.baseVersion` it is a compare-and-set done in one
 * SQL statement (so there is no read-then-write window): the update only matches while the row
 * is still at the version the client loaded, otherwise the caller gets the current record back
 * to show who changed what. `baseVersion: 0` means "create only". Without it the save overwrites
 * regardless (imports and scripts), still bumping the version and recording who saved.
 * Every successful save is recorded in the history in the same transaction.
 */
export async function saveSavedValuationRow(
	symbol: string,
	body: SaveBody,
	userName: string
): Promise<SaveOutcome> {
	const key = symbol.toUpperCase();
	const values = {
		name: body.name,
		lastUpdated: body.lastUpdated,
		assumptions: body.assumptions,
		shares: body.shares,
		activeMethod: body.activeMethod ?? null,
		activeScenario: body.activeScenario ?? null,
		updatedBy: userName
	};

	const outcome = await db.transaction(async (tx) => {
		let version: number | undefined;
		if (body.baseVersion === undefined) {
			const [row] = await tx
				.insert(savedValuations)
				.values({ symbol: key, ...values, version: nextVersionSql(key) })
				.onConflictDoUpdate({
					target: savedValuations.symbol,
					set: { ...values, version: sql`${savedValuations.version} + 1` }
				})
				.returning({ version: savedValuations.version });
			version = row.version;
		} else if (body.baseVersion === 0) {
			const [row] = await tx
				.insert(savedValuations)
				.values({ symbol: key, ...values, version: nextVersionSql(key) })
				.onConflictDoNothing()
				.returning({ version: savedValuations.version });
			version = row?.version;
		} else {
			const [row] = await tx
				.update(savedValuations)
				.set({ ...values, version: sql`${savedValuations.version} + 1` })
				.where(and(eq(savedValuations.symbol, key), eq(savedValuations.version, body.baseVersion)))
				.returning({ version: savedValuations.version });
			version = row?.version;
		}
		if (version === undefined) return null;
		await recordVersion(tx, key, version, 'save', contentOf(body), userName);
		return version;
	});

	if (outcome === null) return { ok: false, current: await getSavedValuationRow(key) };
	return { ok: true, version: outcome, updatedBy: userName };
}

/** Removes a company from the watchlist, keeping its content in the history so it can be
 *  restored. Returns the history id of the removal (for "Undo"), or null if it was not saved. */
export async function removeSavedValuationRow(
	symbol: string,
	userName: string
): Promise<number | null> {
	const key = symbol.toUpperCase();
	return db.transaction(async (tx) => {
		const [row] = await tx
			.delete(savedValuations)
			.where(eq(savedValuations.symbol, key))
			.returning();
		if (!row) return null;
		const content = contentOf(toRecord(row) as SaveBody);
		return recordVersion(tx, key, row.version, 'delete', content, userName);
	});
}

export type RestoreOutcome =
	| { ok: true; version: number }
	| { ok: false; reason: 'not_found' }
	| { ok: false; reason: 'conflict'; current: SavedValuationRecord | null };

/**
 * Makes an old version (or a removed valuation) the current one again, as a new version - the
 * history is never rewritten. With `baseVersion` it refuses (conflict) when the current
 * valuation moved on since the person looked, exactly like a save.
 */
export async function restoreValuationVersion(
	symbol: string,
	versionId: number,
	baseVersion: number | undefined,
	userName: string
): Promise<RestoreOutcome> {
	const key = symbol.toUpperCase();
	const result = await db.transaction(async (tx): Promise<RestoreOutcome> => {
		const [target] = await tx
			.select()
			.from(valuationVersions)
			.where(and(eq(valuationVersions.id, versionId), eq(valuationVersions.symbol, key)));
		if (!target) return { ok: false, reason: 'not_found' };

		const [current] = await tx
			.select()
			.from(savedValuations)
			.where(eq(savedValuations.symbol, key))
			.for('update');
		if (baseVersion !== undefined && (current?.version ?? 0) !== baseVersion) {
			return { ok: false, reason: 'conflict', current: null };
		}

		const snap = target.snapshot as ValuationContent;
		const now = Date.now();
		const values = {
			name: snap.name,
			lastUpdated: now,
			assumptions: snap.assumptions,
			shares: snap.shares,
			activeMethod: snap.activeMethod ?? null,
			activeScenario: snap.activeScenario ?? null,
			updatedBy: userName
		};
		const [row] = await tx
			.insert(savedValuations)
			.values({ symbol: key, ...values, version: nextVersionSql(key) })
			.onConflictDoUpdate({
				target: savedValuations.symbol,
				set: { ...values, version: nextVersionSql(key) }
			})
			.returning({ version: savedValuations.version });
		await recordVersion(
			tx,
			key,
			row.version,
			'restore',
			{ ...snap, lastUpdated: now },
			userName,
			now,
			target
		);
		return { ok: true, version: row.version };
	});
	if (!result.ok && result.reason === 'conflict') {
		return { ...result, current: await getSavedValuationRow(key) };
	}
	return result;
}

/** A company's history, newest first, each entry with what it changed versus the one before. */
export async function listValuationHistory(symbol: string): Promise<ValuationVersionInfo[]> {
	const key = symbol.toUpperCase();
	const rows = await db
		.select()
		.from(valuationVersions)
		.where(eq(valuationVersions.symbol, key))
		.orderBy(valuationVersions.id)
		.limit(500);
	const out: ValuationVersionInfo[] = [];
	let previous: ValuationContent | null = null;
	for (const r of rows) {
		const snap = r.snapshot as ValuationContent;
		out.push({
			id: r.id,
			version: r.version,
			action: r.action,
			savedBy: r.savedBy,
			startedAt: r.startedAt,
			savedAt: r.savedAt,
			changes: r.action === 'delete' || !previous ? [] : diffValuations(previous, snap)
		});
		if (r.action !== 'delete') previous = snap;
	}
	return out.reverse();
}

export async function getValuationVersion(
	symbol: string,
	versionId: number
): Promise<ValuationContent | null> {
	const [row] = await db
		.select({ snapshot: valuationVersions.snapshot })
		.from(valuationVersions)
		.where(
			and(eq(valuationVersions.id, versionId), eq(valuationVersions.symbol, symbol.toUpperCase()))
		);
	return row ? (row.snapshot as ValuationContent) : null;
}

/** Companies removed from the watchlist recently and not added back since. */
export async function listRemovedValuations(): Promise<RemovedValuation[]> {
	const since = Date.now() - REMOVED_LIST_DAYS * 24 * 3600 * 1000;
	const rows = await db.execute<{
		id: number;
		symbol: string;
		name: string;
		saved_by: string;
		saved_at: string;
	}>(sql`
		select * from (
			select distinct on (v.symbol) v.id, v.symbol, v.action, v.snapshot->>'name' as name,
			       v.saved_by, v.saved_at
			from valuation.valuation_versions v
			order by v.symbol, v.id desc
		) latest
		where latest.action = 'delete' and latest.saved_at >= ${since}
		  and not exists (select 1 from valuation.saved_valuations s where s.symbol = latest.symbol)
		order by latest.saved_at desc`);
	return rows.map((r) => ({
		versionId: r.id,
		symbol: r.symbol,
		name: r.name,
		removedBy: r.saved_by,
		removedAt: Number(r.saved_at)
	}));
}

/**
 * Appends to (or, for a continuing autosave session, updates) the history and the activity feed.
 * Must run inside the transaction that changed saved_valuations. Returns the history row id.
 */
async function recordVersion(
	tx: Tx,
	symbol: string,
	version: number,
	action: 'save' | 'delete' | 'restore',
	content: ValuationContent,
	userName: string,
	now = Date.now(),
	restoredFrom?: typeof valuationVersions.$inferSelect
): Promise<number> {
	const [last] = await tx
		.select()
		.from(valuationVersions)
		.where(eq(valuationVersions.symbol, symbol))
		.orderBy(desc(valuationVersions.id))
		.limit(1);

	// The version before `last`: needed to describe a continuing session, and to keep the entry that
	// first added the company separate (so "as first added" stays a version you can go back to).
	let beforeLast: typeof valuationVersions.$inferSelect | undefined;
	if (
		action === 'save' &&
		last?.action === 'save' &&
		last.savedBy === userName &&
		now - last.savedAt < EDIT_SESSION_MS
	) {
		[beforeLast] = await tx
			.select()
			.from(valuationVersions)
			.where(and(eq(valuationVersions.symbol, symbol), lt(valuationVersions.id, last.id)))
			.orderBy(desc(valuationVersions.id))
			.limit(1);
	}
	const continuing = beforeLast !== undefined && beforeLast.action !== 'delete';

	let id: number;
	let before: typeof valuationVersions.$inferSelect | undefined;
	if (continuing) {
		await tx
			.update(valuationVersions)
			.set({ version, snapshot: content, savedAt: now })
			.where(eq(valuationVersions.id, last.id));
		id = last.id;
		before = beforeLast;
	} else {
		const [row] = await tx
			.insert(valuationVersions)
			.values({
				symbol,
				version,
				action,
				snapshot: content,
				savedBy: userName,
				startedAt: now,
				savedAt: now
			})
			.returning({ id: valuationVersions.id });
		id = row.id;
		before = last;
	}

	await logActivity(
		tx,
		{
			actor: userName,
			kind: 'valuation',
			symbol,
			summary: describe(action, content, before, restoredFrom),
			refId: id
		},
		now
	);
	return id;
}

function describe(
	action: 'save' | 'delete' | 'restore',
	content: ValuationContent,
	before: typeof valuationVersions.$inferSelect | undefined,
	restoredFrom?: typeof valuationVersions.$inferSelect
): string {
	const name = content.name;
	if (action === 'delete') return `removed ${name} from the watchlist`;
	if (action === 'restore') {
		if (before?.action === 'delete') return `restored ${name} to the watchlist`;
		const when = restoredFrom
			? new Date(restoredFrom.savedAt).toLocaleString('en-IN', {
					day: 'numeric',
					month: 'short',
					hour: '2-digit',
					minute: '2-digit'
				})
			: '';
		return `rolled ${name} back to version ${restoredFrom?.version ?? '?'}${when ? ` (${when})` : ''}`;
	}
	if (!before || before.action === 'delete') return `added ${name} to the watchlist`;
	const changes = diffValuations(before.snapshot as ValuationContent, content);
	if (!changes.length) return `saved ${name} (no net change)`;
	const more = changes.length > 1 ? ` and ${changes.length - 1} more` : '';
	return `edited ${name}: ${changes[0]}${more}`;
}
