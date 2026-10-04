import type { LayoutServerLoad } from './$types';
import { getPrefs } from '$lib/valuation/server/prefsStore';
import { getAnalysisSettings } from '$lib/valuation/server/analysisSettingsStore';

// Makes the signed-in user (or null on /login) and their own preferences available to every
// page, plus the team's analysis settings (fair value %, etc.). Pages that change either call
// invalidate('app:prefs') so this re-runs.
export const load: LayoutServerLoad = async ({ locals, depends }) => {
	depends('app:prefs');
	return {
		user: locals.user,
		prefs: locals.user ? await getPrefs(locals.user.id) : null,
		analysis: locals.user ? await getAnalysisSettings() : null
	};
};
