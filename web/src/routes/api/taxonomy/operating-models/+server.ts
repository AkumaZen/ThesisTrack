// New addition (not in the original Python app): lets any writer propose a
// brand-new Operating Model, mirroring POST /taxonomy/niches's shape - see
// versioning.ts's resolveOperatingModel for where existence gets enforced.
import { json } from '@sveltejs/kit';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { requireWriteActor, errorResponse, handleAuthError, zodErrorMessage } from '$lib/server/http';
import { proposeOperatingModel, TaxonomyError } from '$lib/server/services/taxonomy';

const modelIn = z.object({
	name: z
		.string()
		.trim()
		.toLowerCase()
		.min(1)
		.max(50)
		.transform((v) => v.replace(/[ -]+/g, '_'))
});

export const POST: RequestHandler = async ({ locals, request }) => {
	try {
		requireWriteActor(locals.actor);
		const parsed = modelIn.safeParse(await request.json());
		if (!parsed.success) return errorResponse(422, zodErrorMessage(parsed.error));

		const model = await proposeOperatingModel(parsed.data.name);
		return json({ id: model.id, name: model.name, is_active: model.isActive, company_count: 0 }, { status: 201 });
	} catch (err) {
		if (err instanceof TaxonomyError) return errorResponse(422, err.message);
		return handleAuthError(err);
	}
};
