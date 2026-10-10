import type { LayoutServerLoad } from './$types';
import { getPrefs } from '$lib/valuation/server/prefsStore';
import { getAnalysisSettings } from '$lib/valuation/server/analysisSettingsStore';
import { isTrackerTestRequest } from '$lib/valuation/server/masterTrackerMock';
import { sanitizePrefs } from '$lib/valuation/prefs';
import { DEFAULT_ANALYSIS_SETTINGS } from '$lib/valuation/analysisSettings';

// Makes the signed-in user (or null on /login) and their own preferences available to every
// page, plus the team's analysis settings (fair value %, etc.). Pages that change either call
// invalidate('app:prefs') so this re-runs.
export const load: LayoutServerLoad = async ({ locals, depends, url }) => {
	depends('app:prefs');
	if ((url.pathname.startsWith('/valuation/master-tracker') || url.pathname === '/valuation/compare') && isTrackerTestRequest(url)) return { user: locals.user, prefs: sanitizePrefs(null), analysis: DEFAULT_ANALYSIS_SETTINGS };
	return {
		user: locals.user,
		prefs: locals.user ? await getPrefs(locals.user.id) : null,
		analysis: locals.user ? await getAnalysisSettings() : null
	};
};
