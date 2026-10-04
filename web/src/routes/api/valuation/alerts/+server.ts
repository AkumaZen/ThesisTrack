import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listAlerts, unreadCount } from '$lib/server/alertStore';
import { ALERT_TYPES, type AlertType } from '$lib/alerts';

export const GET: RequestHandler = async ({ url, locals }) => {
	const typeParam = url.searchParams.get('type');
	if (typeParam && !ALERT_TYPES.includes(typeParam as AlertType)) error(400, 'Unknown alert type.');

	const limit = Number(url.searchParams.get('limit') ?? 100);
	const before = url.searchParams.get('before');
	const [alerts, unread] = await Promise.all([
		listAlerts(locals.user!.id, {
			type: (typeParam as AlertType | null) ?? undefined,
			unreadOnly: url.searchParams.get('unread') === '1',
			limit: Number.isFinite(limit) ? limit : 100,
			before: before != null && Number.isFinite(Number(before)) ? Number(before) : undefined
		}),
		unreadCount(locals.user!.id)
	]);
	return json({ alerts, unread });
};
