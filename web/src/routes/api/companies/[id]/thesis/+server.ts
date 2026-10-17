// Ports PUT /api/companies/{id}/thesis from app/routers/companies.py.
import { json } from '@sveltejs/kit';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { requireWriteActor, errorResponse, handleAuthError, zodErrorMessage } from '$lib/server/http';
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { companies } from '$lib/server/db/schema';
import { EntryPriceError, resolveAmendEntry, saveEntry } from '$lib/server/services/entryPrice';
import { entryDateField, entryPriceField, thesisData } from '$lib/server/schemas/thesis';
import { amendThesis, NotFoundError } from '$lib/server/services/versioning';
import { ScenarioNotFoundError } from '$lib/server/services/scenarios';

export const PUT: RequestHandler = async ({ locals, params, request }) => {
	try {
		const actor = requireWriteActor(locals.actor);
		const body = await request.json();
		const parsed = thesisData.safeParse(body.thesis_data);
		if (!parsed.success) return errorResponse(422, zodErrorMessage(parsed.error));

		const entryIn = z.object({ entry_price: entryPriceField, entry_date: entryDateField }).safeParse(body);
		if (!entryIn.success) return errorResponse(422, zodErrorMessage(entryIn.error));
		const [company] = await db.select().from(companies).where(eq(companies.companyId, params.id!)).limit(1);
		if (!company) return errorResponse(404, `company '${params.id}' not found`);
		// Resolved first so a missing price rejects the whole amendment instead of half of it.
		const entry = await resolveAmendEntry(company, entryIn.data);

		const version = await amendThesis(params.id!, parsed.data, body.change_note, actor.identity);
		if (entry) await saveEntry(params.id!, actor.identity, entry);
		return json({
			version_id: version.versionId,
			version_no: version.versionNo,
			change_note: version.changeNote,
			authored_by: version.authoredBy,
			authored_at: version.authoredAt,
			thesis_data: version.thesisData
		});
	} catch (err) {
		if (err instanceof EntryPriceError) return errorResponse(422, err.message);
		if (err instanceof NotFoundError || err instanceof ScenarioNotFoundError) return errorResponse(404, err.message);
		return handleAuthError(err);
	}
};
