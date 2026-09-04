// GET/POST /api/sectors - list sectors with rollup companies, create a sector.
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { errorResponse, requireActor, requireWriteActor, handleAuthError } from '$lib/server/http';
import { createSectorSchema } from '$lib/server/schemas/sector';
import { createSector, listSectorsWithCompanies } from '$lib/server/services/sectors';

export const GET: RequestHandler = async ({ locals }) => {
	try {
		requireActor(locals.actor);
		const items = await listSectorsWithCompanies();
		return json({ items });
	} catch (err) {
		return handleAuthError(err);
	}
};

export const POST: RequestHandler = async ({ locals, request }) => {
	try {
		const actor = requireWriteActor(locals.actor);
		const parsed = createSectorSchema.safeParse(await request.json());
		if (!parsed.success) return errorResponse(422, parsed.error.message);

		const sector = await createSector(parsed.data, actor.identity);
		return json(sector, { status: 201 });
	} catch (err) {
		return handleAuthError(err);
	}
};
