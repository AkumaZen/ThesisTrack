import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { unreadCount } from '$lib/valuation/server/alertStore';

export const GET: RequestHandler = async ({ locals }) =>
	json({ unread: await unreadCount(locals.user!.id) });
