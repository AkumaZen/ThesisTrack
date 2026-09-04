// Ports app/routers/guidance.py.
import { and, asc, desc, eq } from 'drizzle-orm';
import { db } from '../db';
import { companies, guidanceNotes } from '../db/schema';
import { NotFoundError } from './scenarios';

export async function createGuidance(companyId: string, blockKey: string, note: string, actorIdentity: string) {
	const [company] = await db.select().from(companies).where(eq(companies.companyId, companyId)).limit(1);
	if (!company) throw new NotFoundError(`company '${companyId}' not found`);

	const [row] = await db
		.insert(guidanceNotes)
		.values({ companyId, blockKey, note, createdBy: actorIdentity })
		.returning();
	return { note: row, companyName: company.name };
}

export async function listGuidance(companyId: string | null, blockKey: string | null, status: string | null) {
	const conditions = [];
	if (companyId) conditions.push(eq(guidanceNotes.companyId, companyId));
	if (blockKey) conditions.push(eq(guidanceNotes.blockKey, blockKey));
	if (status) conditions.push(eq(guidanceNotes.status, status));

	const rows = await db
		.select({ note: guidanceNotes, companyName: companies.name })
		.from(guidanceNotes)
		.innerJoin(companies, eq(guidanceNotes.companyId, companies.companyId))
		.where(conditions.length ? and(...conditions) : undefined)
		.orderBy(asc(guidanceNotes.status), desc(guidanceNotes.createdAt));
	return rows;
}

export async function resolveGuidance(guidanceId: number, actorIdentity: string) {
	const [note] = await db.select().from(guidanceNotes).where(eq(guidanceNotes.id, guidanceId)).limit(1);
	if (!note) return null;

	await db
		.update(guidanceNotes)
		.set({ status: 'resolved', resolvedBy: actorIdentity, resolvedAt: new Date() })
		.where(eq(guidanceNotes.id, guidanceId));

	const [updated] = await db.select().from(guidanceNotes).where(eq(guidanceNotes.id, guidanceId)).limit(1);
	const [company] = await db.select().from(companies).where(eq(companies.companyId, updated.companyId)).limit(1);
	return { note: updated, companyName: company?.name ?? null };
}

export async function deleteGuidance(guidanceId: number) {
	const [note] = await db.select().from(guidanceNotes).where(eq(guidanceNotes.id, guidanceId)).limit(1);
	if (!note) return false;
	await db.delete(guidanceNotes).where(eq(guidanceNotes.id, guidanceId));
	return true;
}
