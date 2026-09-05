// Ports POST /api/taxonomy/niches from app/routers/taxonomy.py.
import { json } from '@sveltejs/kit';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { requireWriteActor, errorResponse, handleAuthError, zodErrorMessage } from '$lib/server/http';
import { proposeNiche, TaxonomyError } from '$lib/server/services/taxonomy';

const nicheIn = z.object({
	broad_industry: z.string(),
	name: z.string()
});

export const POST: RequestHandler = async ({ locals, request }) => {
	try {
		requireWriteActor(locals.actor);
		const body = await request.json();
		const parsed = nicheIn.safeParse(body);
		if (!parsed.success) return errorResponse(422, zodErrorMessage(parsed.error));

		const niche = await proposeNiche(parsed.data.broad_industry, parsed.data.name);
		return json({ id: niche.id, name: niche.name, is_active: niche.isActive, company_count: 0 }, { status: 201 });
	} catch (err) {
		if (err instanceof TaxonomyError) return errorResponse(422, err.message);
		return handleAuthError(err);
	}
};
