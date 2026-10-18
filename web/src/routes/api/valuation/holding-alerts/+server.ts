import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { validateHoldingSettings } from '$lib/valuation/alertRules';
import { saveHoldingSettings } from '$lib/valuation/server/marketIntelStore';

// Sets how many percentage points of change in the promoter, FII or DII share (when a new quarter's
// shareholding lands) is worth an alert for the person's tracked companies. Empty turns a group off.
export const PUT: RequestHandler = async ({ request, locals }) => {
	const checked = validateHoldingSettings(await request.json().catch(() => null));
	if (!checked.ok) error(400, checked.message);
	await saveHoldingSettings(locals.user!.id, checked.value);
	return json(checked.value);
};
