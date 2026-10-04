import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { recordWatchlistVisit } from '$lib/server/prefsStore';

/** Marks the watchlist as seen now; returns the previous visit so the page can highlight what
 *  teammates changed since then. */
export const POST: RequestHandler = async ({ locals }) =>
	json({ previous: await recordWatchlistVisit(locals.user!.id) });
