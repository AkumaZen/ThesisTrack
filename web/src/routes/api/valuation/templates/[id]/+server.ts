import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { templateContentProblem, templateNameProblem } from '$lib/templates';
import type { MethodId } from '$lib/valuationEngine';
import { deleteTemplate, updateTemplate } from '$lib/server/templatesStore';

function idOf(raw: string): number {
	const id = Number(raw);
	if (!Number.isInteger(id) || id < 1) error(404, 'No such template.');
	return id;
}

/** Body: { name? } and/or { assumptions, activeMethod } (both, to replace the content). */
export const PUT: RequestHandler = async ({ params, request, locals }) => {
	const id = idOf(params.id);
	const body = (await request.json().catch(() => null)) as {
		name?: unknown;
		assumptions?: unknown;
		activeMethod?: unknown;
	} | null;
	if (!body || typeof body !== 'object') error(400, 'Expected a JSON object.');
	const patch: { name?: string; assumptions?: unknown; activeMethod?: MethodId } = {};
	if (body.name !== undefined) {
		const problem = templateNameProblem(body.name);
		if (problem) error(400, problem);
		patch.name = body.name as string;
	}
	if (body.assumptions !== undefined || body.activeMethod !== undefined) {
		const problem = templateContentProblem(body);
		if (problem) error(400, problem);
		patch.assumptions = body.assumptions;
		patch.activeMethod = body.activeMethod as MethodId;
	}
	if (!Object.keys(patch).length) error(400, 'Nothing to change.');
	const res = await updateTemplate(id, patch, locals.user!.username);
	if (!res.ok && res.reason === 'duplicate') error(409, 'Another template already has that name.');
	if (!res.ok) error(404, 'No such template.');
	return json({ ok: true });
};

export const DELETE: RequestHandler = async ({ params, locals }) => {
	const res = await deleteTemplate(idOf(params.id), locals.user!);
	if (!res.ok && res.reason === 'forbidden') {
		error(403, 'Only the person who created a template, or the admin, can delete it.');
	}
	if (!res.ok) error(404, 'No such template.');
	return new Response(null, { status: 204 });
};
