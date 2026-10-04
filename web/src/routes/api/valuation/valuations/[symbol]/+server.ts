import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { assumptionsProblem, type SaveBody } from '$lib/valuation/savedValuations';
import {
	getSavedValuationRow,
	saveSavedValuationRow,
	removeSavedValuationRow
} from '$lib/valuation/server/savedValuationsStore';

export const GET: RequestHandler = async ({ params }) => {
	const record = await getSavedValuationRow(params.symbol);
	if (!record) error(404, 'No saved valuation for this symbol');
	return json(record);
};

/** Body: a saved valuation plus an optional `baseVersion` (the version the client loaded). When
 *  the stored version has moved on, nothing is written and the response is 409 with the current
 *  record, so the client can say who changed what instead of silently overwriting. */
export const PUT: RequestHandler = async ({ params, request, locals }) => {
	const body = (await request.json().catch(() => null)) as SaveBody | null;
	if (
		!body ||
		typeof body !== 'object' ||
		!body.assumptions ||
		typeof body.assumptions !== 'object' ||
		typeof body.shares !== 'number' ||
		!Number.isFinite(body.shares) ||
		typeof body.name !== 'string' ||
		typeof body.lastUpdated !== 'number'
	) {
		error(400, 'Invalid saved-valuation payload');
	}
	const problem = assumptionsProblem(body.assumptions);
	if (problem) error(400, `Invalid assumptions: ${problem}.`);
	if (
		body.baseVersion !== undefined &&
		(!Number.isInteger(body.baseVersion) || body.baseVersion < 0)
	) {
		error(400, '"baseVersion" must be a whole number, 0 or more.');
	}

	const outcome = await saveSavedValuationRow(params.symbol, body, locals.user!.username);
	if (!outcome.ok) return json({ conflict: true, current: outcome.current }, { status: 409 });
	return json({ ok: true, version: outcome.version, updatedBy: outcome.updatedBy });
};

/** Any signed-in analyst may remove a company: the content stays in the history and the
 *  response carries the history id that restores it (Undo, or the "Recently removed" list). */
export const DELETE: RequestHandler = async ({ params, locals }) => {
	const versionId = await removeSavedValuationRow(params.symbol, locals.user!.username);
	return json({ ok: true, versionId });
};
