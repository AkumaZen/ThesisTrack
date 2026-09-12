// Free-text company notes - a heading + an ordered sequence of blocks,
// sitting alongside custom tables (same section tagging) but with no
// columns/rows of its own. Mirrors customTables.ts's shape for the same
// reasons (created/edited inline, no open/resolve workflow like guidance
// notes have). A note's `blocks` mix free text and table references in
// whatever order the analyst wrote them - Text/Table/Text/Table, or any
// combination - since a note is a small document, not just a paragraph.
import { asc, eq } from 'drizzle-orm';
import { db } from '../db';
import { companies, customNotes } from '../db/schema';
import { NotFoundError } from './scenarios';

export type NoteBlock = { type: 'text'; text: string } | { type: 'table'; table_id: number };

// `body` is kept as a derived plain-text fallback (every text block joined
// with a blank line) - nothing outside this file reads it as authoritative
// content, but the NOT NULL column stays satisfied without a migration.
function deriveBody(blocks: NoteBlock[]): string {
	return blocks
		.filter((b): b is Extract<NoteBlock, { type: 'text' }> => b.type === 'text')
		.map((b) => b.text)
		.join('\n\n');
}

export async function createNote(companyId: string, heading: string, blocks: NoteBlock[], section: string | null, actorIdentity: string) {
	const [company] = await db.select().from(companies).where(eq(companies.companyId, companyId)).limit(1);
	if (!company) throw new NotFoundError(`company '${companyId}' not found`);

	const [note] = await db
		.insert(customNotes)
		.values({ companyId, heading, body: deriveBody(blocks), blocks, section, createdBy: actorIdentity })
		.returning();
	return note;
}

export async function listNotes(companyId: string) {
	return db.select().from(customNotes).where(eq(customNotes.companyId, companyId)).orderBy(asc(customNotes.createdAt));
}

export async function patchNote(
	noteId: number,
	fields: { heading?: string | null; blocks?: NoteBlock[] | null; section?: string | null },
	fieldsSet: Set<string>
) {
	const [note] = await db.select().from(customNotes).where(eq(customNotes.id, noteId)).limit(1);
	if (!note) return null;

	const update: Record<string, unknown> = {};
	if (fieldsSet.has('heading') && fields.heading != null) update.heading = fields.heading;
	if (fieldsSet.has('blocks') && fields.blocks != null) {
		update.blocks = fields.blocks;
		update.body = deriveBody(fields.blocks);
	}
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
