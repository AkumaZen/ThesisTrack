import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { addNote } from '$lib/server/teamStore';
import { noteProblem, type NoteKind } from '$lib/team';

const KINDS: NoteKind[] = ['thesis', 'note', 'comment'];

/** Body: { kind: 'thesis' | 'note' | 'comment', body }. Any signed-in analyst may add. */
export const POST: RequestHandler = async ({ params, request, locals }) => {
	const input = (await request.json().catch(() => null)) as {
		kind?: unknown;
		body?: unknown;
	} | null;
	if (!KINDS.includes(input?.kind as NoteKind))
		error(400, '"kind" must be thesis, note or comment.');
	const problem = noteProblem(input?.body);
	if (problem) error(400, problem);
	const note = await addNote(
		params.symbol,
		input!.kind as NoteKind,
		input!.body as string,
		locals.user!.username
	);
	return json(note, { status: 201 });
};
