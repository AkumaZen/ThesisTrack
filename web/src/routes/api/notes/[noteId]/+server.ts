// PATCH/DELETE /api/notes/{note_id} - mirrors tables/[tableId]/+server.ts.
import { json } from '@sveltejs/kit';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { requireWriteActor, errorResponse, handleAuthError, zodErrorMessage } from '$lib/server/http';
import { deleteNote, patchNote, type NoteBlock } from '$lib/server/services/customNotes';
import { PILLAR_KEYS } from '$lib/server/pillars';

const noteBlock = z.union([
	z.object({ type: z.literal('text'), text: z.string() }),
	z.object({ type: z.literal('table'), table_id: z.number() })
]);

const noteUpdate = z.object({
	heading: z.string().min(1).max(120).nullish(),
	blocks: z.array(noteBlock).min(1).nullish(),
	section: z
		.string()
		.nullish()
		.refine((v) => v == null || (PILLAR_KEYS as readonly string[]).includes(v), {
			message: `section must be one of ${JSON.stringify(PILLAR_KEYS)} or null`
		})
});

function noteToOut(note: {
	id: number;
	companyId: string;
	heading: string;
	body: string;
	blocks: unknown;
	section: string | null;
	createdBy: string;
	createdAt: Date;
	updatedAt: Date;
}) {
	return {
		id: note.id,
		company_id: note.companyId,
		heading: note.heading,
		body: note.body,
		blocks: note.blocks,
		section: note.section,
		created_by: note.createdBy,
		created_at: note.createdAt,
		updated_at: note.updatedAt
	};
}

export const PATCH: RequestHandler = async ({ locals, params, request }) => {
	try {
		requireWriteActor(locals.actor);
		const noteId = Number(params.noteId);
		const body = await request.json();
		const parsed = noteUpdate.safeParse(body);
		if (!parsed.success) return errorResponse(422, zodErrorMessage(parsed.error));

		const fieldsSet = new Set(Object.keys(body));
		const updated = await patchNote(noteId, parsed.data as { heading?: string | null; blocks?: NoteBlock[] | null; section?: string | null }, fieldsSet);
		if (!updated) return errorResponse(404, `note ${noteId} not found`);
		return json(noteToOut(updated));
	} catch (err) {
		return handleAuthError(err);
	}
};

export const DELETE: RequestHandler = async ({ locals, params }) => {
	try {
		requireWriteActor(locals.actor);
		const noteId = Number(params.noteId);
		const ok = await deleteNote(noteId);
		if (!ok) return errorResponse(404, `note ${noteId} not found`);
		return new Response(null, { status: 204 });
	} catch (err) {
		return handleAuthError(err);
	}
};
