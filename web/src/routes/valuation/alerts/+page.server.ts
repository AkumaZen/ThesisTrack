import type { PageServerLoad } from './$types';
import { getAlertSettings, listAlerts, unreadCount } from '$lib/valuation/server/alertStore';
import { emailStatus } from '$lib/valuation/server/alertNotify';

// Instant DB reads only (no live market data) - the page renders immediately and the check
// buttons trigger the slower work on demand.
export const load: PageServerLoad = async ({ locals }) => {
	const userId = locals.user!.id;
	const [alerts, unread, settings] = await Promise.all([
		listAlerts(userId, { limit: 200 }),
		unreadCount(userId),
		getAlertSettings(userId)
	]);
	return { alerts, unread, settings, email: emailStatus() };
};
