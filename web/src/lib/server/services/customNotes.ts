// Free-text company notes - a heading + body block, sitting alongside custom
// tables (same section tagging) but with no columns/rows of its own. Mirrors
// customTables.ts's shape for the same reasons (created/edited inline, no
// open/resolve workflow like guidance notes have).
import { asc, eq } from 'drizzle-orm';
import { db } from '../db';
import { companies, customNotes } from '../db/schema';
import { NotFoundError } from './scenarios';

export async function createNote(companyId: string, heading: string, body: string, section: string | null, actorIdentity: string) {
	const [company] = await db.select().from(companies).where(eq(companies.companyId, companyId)).limit(1);
	if (!company) throw new NotFoundError(`company '${companyId}' not found`);

	const [note] = await db.insert(customNotes).values({ companyId, heading, body, section, createdBy: actorIdentity }).returning();
	return note;
}

export async function listNotes(companyId: string) {
	return db.select().from(customNotes).where(eq(customNotes.companyId, companyId)).orderBy(asc(customNotes.createdAt));
}

export async function patchNote(noteId: number, fields: { heading?: string | null; body?: string | null; section?: string | null }, fieldsSet: Set<string>) {
	const [note] = await db.select().from(customNotes).where(eq(customNotes.id, noteId)).limit(1);
	if (!note) return null;

	const update: Record<string, unknown> = {};
	if (fieldsSet.has('heading') && fields.heading != null) update.heading = fields.heading;
	if (fieldsSet.has('body') && fields.body != null) update.body = fields.body;
	if (fieldsSet.has('section')) update.section = fields.section ?? null;

	if (Object.keys(update).length) {
		update.updatedAt = new Date();
		await db.update(customNotes).set(update).where(eq(customNotes.id, noteId));
	}
	const [updated] = await db.select().from(customNotes).where(eq(customNotes.id, noteId)).limit(1);
	return updated;
}

export async function deleteNote(noteId: number) {
	const [note] = await db.select().from(customNotes).where(eq(customNotes.id, noteId)).limit(1);
	if (!note) return false;
	await db.delete(customNotes).where(eq(customNotes.id, noteId));
	return true;
}
