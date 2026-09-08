// POST/GET /api/companies/{id}/notes - mirrors the tables/+server.ts pattern.
import { json } from '@sveltejs/kit';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { requireActor, requireWriteActor, errorResponse, handleAuthError, zodErrorMessage } from '$lib/server/http';
import { createNote, listNotes } from '$lib/server/services/customNotes';
import { NotFoundError } from '$lib/server/services/scenarios';
import { PILLAR_KEYS } from '$lib/server/pillars';

const noteCreate = z.object({
	heading: z.string().min(1).max(120),
	body: z.string().min(1),
	section: z
		.string()
		.nullish()
		.refine((v) => v == null || (PILLAR_KEYS as readonly string[]).includes(v), {
			message: `section must be one of ${JSON.stringify(PILLAR_KEYS)} or null`
		})
});

function noteToOut(note: { id: number; companyId: string; heading: string; body: string; section: string | null; createdBy: string; createdAt: Date; updatedAt: Date }) {
	return {
		id: note.id,
		company_id: note.companyId,
		heading: note.heading,
		body: note.body,
		section: note.section,
		created_by: note.createdBy,
		created_at: note.createdAt,
		updated_at: note.updatedAt
	};
}

export const POST: RequestHandler = async ({ locals, params, request }) => {
	try {
		const actor = requireWriteActor(locals.actor);
		const body = await request.json();
		const parsed = noteCreate.safeParse(body);
		if (!parsed.success) return errorResponse(422, zodErrorMessage(parsed.error));

		const note = await createNote(params.id!, parsed.data.heading, parsed.data.body, parsed.data.section ?? null, actor.identity);
		return json(noteToOut(note), { status: 201 });
	} catch (err) {
		if (err instanceof NotFoundError) return errorResponse(404, err.message);
		return handleAuthError(err);
	}
};

export const GET: RequestHandler = async ({ locals, params }) => {
	try {
		requireActor(locals.actor);
		const notes = await listNotes(params.id!);
		return json(notes.map(noteToOut));
	} catch (err) {
		return handleAuthError(err);
	}
};
