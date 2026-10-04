import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { templateContentProblem, templateNameProblem } from '$lib/templates';
import type { MethodId } from '$lib/valuationEngine';
import { createTemplate, listTemplates, userDefaultTemplateId } from '$lib/server/templatesStore';

export const GET: RequestHandler = async ({ locals }) =>
	json({
		templates: await listTemplates(),
		myDefaultId: await userDefaultTemplateId(locals.user!.id)
	});

/** Body: { name, assumptions, activeMethod }. Anyone on the team may add a template. */
export const POST: RequestHandler = async ({ request, locals }) => {
	const body = (await request.json().catch(() => null)) as {
		name?: unknown;
		assumptions?: unknown;
		activeMethod?: unknown;
	} | null;
	if (!body || typeof body !== 'object') error(400, 'Expected a JSON object.');
	const problem = templateNameProblem(body.name) ?? templateContentProblem(body);
	if (problem) error(400, problem);
	const res = await createTemplate(
		{
			name: body.name as string,
			assumptions: body.assumptions,
			activeMethod: body.activeMethod as MethodId
		},
		locals.user!.username
	);
	if (!res.ok) error(409, `A template called "${(body.name as string).trim()}" already exists.`);
	return json({ id: res.value }, { status: 201 });
};
