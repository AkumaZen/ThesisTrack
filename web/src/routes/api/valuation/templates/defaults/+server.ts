import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { findAnyCustomSector } from '$lib/valuation/server/sectorStore';
import { setTemplateDefault } from '$lib/valuation/server/templatesStore';

/** Body: { scope: 'me' | 'basket:<key>', templateId: number | null }. `me` is the caller's own
 *  default; a basket default applies to the whole team. null clears it. */
export const PUT: RequestHandler = async ({ request, locals }) => {
	const body = (await request.json().catch(() => null)) as {
		scope?: unknown;
		templateId?: unknown;
	} | null;
	const templateId = body?.templateId;
	if (templateId !== null && !(Number.isInteger(templateId) && (templateId as number) > 0)) {
		error(400, '"templateId" must be a template id or null.');
	}
	let scope: string;
	if (body?.scope === 'me') {
		scope = `user:${locals.user!.id}`;
	} else if (typeof body?.scope === 'string' && body.scope.startsWith('basket:')) {
		const key = body.scope.slice('basket:'.length);
		if (!(await findAnyCustomSector(key))) error(404, 'No such sector basket.');
		scope = `basket:${key}`;
	} else {
		error(400, '"scope" must be "me" or "basket:<key>".');
	}
	const res = await setTemplateDefault(scope, templateId as number | null, locals.user!.username);
	if (!res.ok) error(404, 'No such template.');
	return json({ ok: true });
};
