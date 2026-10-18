import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { MAX_SAVED_KEYWORDS, normaliseKeyword } from '$lib/valuation/announcementScans';
import { addKeyword, countKeywords } from '$lib/valuation/server/marketIntelStore';

// Saves a keyword to the person's own list on the announcements page.
export const POST: RequestHandler = async ({ request, locals }) => {
	const body = (await request.json().catch(() => null)) as { keyword?: unknown } | null;
	const keyword = normaliseKeyword(body?.keyword);
	if (!keyword) error(400, 'Enter 2 to 60 characters.');
	const userId = locals.user!.id;
	if ((await countKeywords(userId)) >= MAX_SAVED_KEYWORDS) error(400, `You can save up to ${MAX_SAVED_KEYWORDS} keywords. Remove one first.`);
	if (!(await addKeyword(userId, keyword))) error(409, `"${keyword}" is already saved.`);
	return json({ ok: true, keyword });
};
