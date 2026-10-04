import { json } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { strengthFilterPrefs } from '$lib/server/db/valuationSchema';
import { DEFAULT_PREFS } from '$lib/valuation/prefs';
import { updatePrefs } from '$lib/valuation/server/prefsStore';

/**
 * "Reset all preferences" for the signed-in person: display preferences (watchlist columns, sort
 * and view, the figures on sector cards) back to the standard set, and the remembered Strength &
 * Volume filters dropped. Saved alert rules are not touched. Everyone resets only their own.
 */
export const POST: RequestHandler = async ({ locals }) => {
	const userId = locals.user!.id;
	await updatePrefs(userId, { watchlist: DEFAULT_PREFS.watchlist, sectorCard: DEFAULT_PREFS.sectorCard });
	await db.delete(strengthFilterPrefs).where(eq(strengthFilterPrefs.userId, userId));
	return json({ ok: true });
};
