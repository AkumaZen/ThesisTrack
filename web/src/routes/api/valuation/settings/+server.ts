import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { parseAnalysisSettings } from '$lib/valuation/analysisSettings';
import { getAnalysisSettings, saveAnalysisSettings } from '$lib/valuation/server/analysisSettingsStore';

export const GET: RequestHandler = async () => json(await getAnalysisSettings());

/** Body: a partial { rotation, scan } on top of the current settings, or { reset: true } for the
 *  defaults. Shared by the whole team, so only the admin may change it. */
export const PUT: RequestHandler = async ({ request, locals }) => {
	if (locals.user?.role !== 'admin') error(403, 'Only the admin can change team settings.');
	const body = await request.json().catch(() => null);
	const parsed =
		body && typeof body === 'object' && (body as { reset?: unknown }).reset === true
			? parseAnalysisSettings({})
			: parseAnalysisSettings(body, await getAnalysisSettings());
	if ('error' in parsed) error(400, parsed.error);
	await saveAnalysisSettings(parsed.value);
	return json(parsed.value);
};
