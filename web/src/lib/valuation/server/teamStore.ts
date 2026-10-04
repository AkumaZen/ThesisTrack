import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { companyNotes, coverage, valuationStatus } from '$lib/server/db/valuationSchema';
import { users } from '$lib/server/db/schema';
import { logActivity } from './activityStore';
import { resolveCompanyName } from './companyNames';
import {
	REVIEW_STATUS_LABELS,
	type CompanyNote,
	type CompanyTeamData,
	type CoverageInfo,
	type NoteKind,
	type ReviewStatus,
	type StatusInfo,
	type TeamMember
} from '$lib/valuation/team';

const NOTE_ACTIVITY: Record<NoteKind, string> = {
	thesis: 'updated the investment thesis',
	note: 'added a note',
	comment: 'commented'
};

/** First line of a note, shortened, for the activity feed. */
function excerpt(body: string): string {
	const line = body.trim().split(/\r?\n/)[0];
	return line.length > 90 ? `${line.slice(0, 87)}…` : line;
}

export async function getCompanyTeam(symbol: string): Promise<CompanyTeamData> {
	const key = symbol.toUpperCase();
	const [notes, status, cov, members] = await Promise.all([
		db
			.select()
			.from(companyNotes)
			.where(and(eq(companyNotes.symbol, key), isNull(companyNotes.deletedAt)))
			.orderBy(desc(companyNotes.createdAt), desc(companyNotes.id)),
		getStatus(key),
		getCoverage(key),
		listMembers()
	]);
	return {
		notes: notes.map((n): CompanyNote => ({
			id: n.id,
			kind: n.kind,
			body: n.body,
			author: n.author,
			createdAt: n.createdAt,
			editedAt: n.editedAt
		})),
		status,
		coverage: cov,
		members
	};
}

export async function listMembers(): Promise<TeamMember[]> {
	return db
		.select({ id: users.id, username: users.displayName })
		.from(users)
		.where(eq(users.isActive, true))
		.orderBy(sql`lower(${users.displayName})`);
}

export async function addNote(
	symbol: string,
	kind: NoteKind,
	body: string,
	author: string
): Promise<CompanyNote> {
	const key = symbol.toUpperCase();
	const now = Date.now();
	const name = await resolveCompanyName(key);
	return db.transaction(async (tx) => {
		const [row] = await tx
			.insert(companyNotes)
			.values({ symbol: key, kind, body: body.trim(), author, createdAt: now })
			.returning();
		await logActivity(
			tx,
			{
				actor: author,
				kind,
				symbol: key,
				summary: `${NOTE_ACTIVITY[kind]} on ${name}: "${excerpt(body)}"`
			},
			now
		);
		return {
			id: row.id,
			kind: row.kind,
			body: row.body,
			author: row.author,
			createdAt: row.createdAt,
			editedAt: null
		};
	});
}

export type NoteChange = 'ok' | 'not_found' | 'forbidden';

/** Only the author edits their note. A thesis is never edited in place: a new one is added, so the
 *  history of how the thesis evolved is kept. */
export async function editNote(id: number, body: string, user: string): Promise<NoteChange> {
	const [note] = await db
		.select()
		.from(companyNotes)
		.where(and(eq(companyNotes.id, id), isNull(companyNotes.deletedAt)));
	if (!note) return 'not_found';
	if (note.author !== user || note.kind === 'thesis') return 'forbidden';
	await db
		.update(companyNotes)
		.set({ body: body.trim(), editedAt: Date.now() })
		.where(eq(companyNotes.id, id));
	return 'ok';
}

/** The author or an admin may delete; the row is kept (soft delete) for the record. */
export async function deleteNote(id: number, user: string, isAdmin: boolean): Promise<NoteChange> {
	const [note] = await db
		.select()
		.from(companyNotes)
		.where(and(eq(companyNotes.id, id), isNull(companyNotes.deletedAt)));
	if (!note) return 'not_found';
	if (note.author !== user && !isAdmin) return 'forbidden';
	await db.update(companyNotes).set({ deletedAt: Date.now() }).where(eq(companyNotes.id, id));
	return 'ok';
}

export async function getStatus(symbol: string): Promise<StatusInfo | null> {
	const [row] = await db
		.select()
		.from(valuationStatus)
		.where(eq(valuationStatus.symbol, symbol.toUpperCase()));
	return row
		? { status: row.status, atVersion: row.atVersion, setBy: row.setBy, setAt: row.setAt }
		: null;
}

/** Sets the review status, optionally with a comment explaining it (both in one transaction). */
export async function setStatus(
	symbol: string,
	status: ReviewStatus,
	atVersion: number | null,
	user: string,
	comment?: string
): Promise<StatusInfo> {
	const key = symbol.toUpperCase();
	const now = Date.now();
	const info: StatusInfo = { status, atVersion, setBy: user, setAt: now };
	const name = await resolveCompanyName(key);
	await db.transaction(async (tx) => {
		await tx
			.insert(valuationStatus)
			.values({ symbol: key, status, atVersion, setBy: user, setAt: now })
			.onConflictDoUpdate({
				target: valuationStatus.symbol,
				set: { status, atVersion, setBy: user, setAt: now }
			});
		if (comment?.trim()) {
			await tx.insert(companyNotes).values({
				symbol: key,
				kind: 'comment',
				body: comment.trim(),
				author: user,
				createdAt: now
			});
		}
		const why = comment?.trim() ? `: "${excerpt(comment)}"` : '';
		await logActivity(
			tx,
			{
				actor: user,
				kind: 'status',
				symbol: key,
				summary: `marked ${name} "${REVIEW_STATUS_LABELS[status]}"${why}`
			},
			now
		);
	});
	return info;
}

export async function getCoverage(symbol: string): Promise<CoverageInfo | null> {
	const [row] = await db
		.select({
			userId: coverage.userId,
			username: users.displayName,
			assignedBy: coverage.assignedBy,
			assignedAt: coverage.assignedAt
		})
		.from(coverage)
		.innerJoin(users, eq(users.id, coverage.userId))
		.where(eq(coverage.symbol, symbol.toUpperCase()));
	return row ?? null;
}

/** symbol -> covering analyst's username, for the watchlist's "My coverage" filter. */
export async function coverageMap(): Promise<Record<string, string>> {
	const rows = await db
		.select({ symbol: coverage.symbol, username: users.displayName })
		.from(coverage)
		.innerJoin(users, eq(users.id, coverage.userId));
	return Object.fromEntries(rows.map((r) => [r.symbol, r.username]));
}

/** Assigns (userId) or clears (null) the covering analyst. Returns false for an unknown user. */
export async function setCoverage(
	symbol: string,
	userId: number | null,
	by: string
): Promise<CoverageInfo | null | false> {
	const key = symbol.toUpperCase();
	const now = Date.now();
	const name = await resolveCompanyName(key);
	return db.transaction(async (tx) => {
		if (userId === null) {
			const removed = await tx.delete(coverage).where(eq(coverage.symbol, key)).returning();
			if (removed.length) {
				await logActivity(
					tx,
					{ actor: by, kind: 'coverage', symbol: key, summary: `cleared the coverage of ${name}` },
					now
				);
			}
			return null;
		}
		const [user] = await tx
			.select({ username: users.displayName })
			.from(users)
			.where(eq(users.id, userId));
		if (!user) return false;
		await tx
			.insert(coverage)
			.values({ symbol: key, userId, assignedBy: by, assignedAt: now })
			.onConflictDoUpdate({
				target: coverage.symbol,
				set: { userId, assignedBy: by, assignedAt: now }
			});
		const summary =
			user.username === by ? `now covers ${name}` : `assigned ${name} to ${user.username}`;
		await logActivity(tx, { actor: by, kind: 'coverage', symbol: key, summary }, now);
		return { userId, username: user.username, assignedBy: by, assignedAt: now };
	});
}
