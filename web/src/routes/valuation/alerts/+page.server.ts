import type { PageServerLoad } from './$types';
import { getAlertSettings, listAlerts, unreadCount } from '$lib/valuation/server/alertStore';
import { emailStatus } from '$lib/valuation/server/alertNotify';
import { listRules } from '$lib/valuation/server/strengthRulesStore';

// Instant DB reads only (no live market data) - the page renders immediately and the check
// buttons trigger the slower work on demand.
export const load: PageServerLoad = async ({ locals }) => {
	const userId = locals.user!.id;
	const [alerts, unread, settings, rules] = await Promise.all([
		listAlerts(userId, { limit: 200 }),
		unreadCount(userId),
		getAlertSettings(userId),
		listRules()
	]);
	return { alerts, unread, settings, rules, email: emailStatus() };
};
