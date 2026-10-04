import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { deleteNote, editNote, type NoteChange } from '$lib/server/teamStore';
import { noteProblem } from '$lib/team';

function idOf(raw: string): number {
	const id = Number(raw);
	if (!Number.isInteger(id) || id <= 0) error(400, 'Invalid note id');
	return id;
}

function respond(result: NoteChange, forbidden: string) {
	if (result === 'not_found') error(404, 'That note no longer exists.');
	if (result === 'forbidden') error(403, forbidden);
	return json({ ok: true });
}

/** Body: { body }. Only the author may edit, and a thesis is replaced by adding a new one. */
export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	const input = (await request.json().catch(() => null)) as { body?: unknown } | null;
	const problem = noteProblem(input?.body);
	if (problem) error(400, problem);
	const result = await editNote(idOf(params.id), input!.body as string, locals.user!.username);
	return respond(
		result,
		'Only the author can edit this, and a thesis is updated by writing a new one.'
	);
};

/** The author or an admin may delete. */
export const DELETE: RequestHandler = async ({ params, locals }) => {
	const result = await deleteNote(
		idOf(params.id),
		locals.user!.username,
		locals.user!.role === 'admin'
	);
	return respond(result, 'Only the author or an admin can delete this.');
};
