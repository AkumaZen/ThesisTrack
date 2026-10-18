import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getOnlyImportant, setOnlyImportant } from '$lib/valuation/server/intelStore';

// The person's own notification preferences. Open to read-only accounts (see PERSONAL_API_PREFIXES).
export const GET: RequestHandler = async ({ locals }) => json({ onlyImportant: await getOnlyImportant(locals.user!.id) });

export const PUT: RequestHandler = async ({ request, locals }) => {
	const body = (await request.json().catch(() => null)) as { onlyImportant?: unknown } | null;
	if (typeof body?.onlyImportant !== 'boolean') error(400, 'Say whether to notify only important filings.');
	await setOnlyImportant(locals.user!.id, body.onlyImportant);
	return json({ onlyImportant: body.onlyImportant });
};
