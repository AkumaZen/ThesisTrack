// Ports POST /api/companies/{id}/guidance from app/routers/guidance.py.
import { json } from '@sveltejs/kit';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { requireWriteActor, errorResponse, handleAuthError, zodErrorMessage } from '$lib/server/http';
import { createGuidance } from '$lib/server/services/guidance';
import { NotFoundError } from '$lib/server/services/scenarios';

const BLOCK_KEYS = [
	'the_business',
	'the_growth_engine',
	'the_big_change',
	'proof_points',
	'what_can_kill_it',
	'why_we_believe_it',
	'health_check',
	'references',
	'general'
] as const;

const guidanceIn = z.object({
	block_key: z.enum(BLOCK_KEYS),
	note: z.string().min(1)
});

function toOut(note: {
	id: number;
	companyId: string;
	blockKey: string;
	note: string;
	status: string;
	createdBy: string;
	createdAt: Date;
	resolvedBy: string | null;
	resolvedAt: Date | null;
}, companyName: string | null) {
	return {
		id: note.id,
		company_id: note.companyId,
		company_name: companyName,
		block_key: note.blockKey,
		note: note.note,
		status: note.status,
		created_by: note.createdBy,
		created_at: note.createdAt,
		resolved_by: note.resolvedBy,
		resolved_at: note.resolvedAt
	};
}

export const POST: RequestHandler = async ({ locals, params, request }) => {
	try {
		const actor = requireWriteActor(locals.actor);
		const body = await request.json();
		const parsed = guidanceIn.safeParse(body);
		if (!parsed.success) return errorResponse(422, zodErrorMessage(parsed.error));

		const { note, companyName } = await createGuidance(params.id!, parsed.data.block_key, parsed.data.note, actor.identity);
		return json(toOut(note, companyName), { status: 201 });
	} catch (err) {
		if (err instanceof NotFoundError) return errorResponse(404, err.message);
		return handleAuthError(err);
	}
};
