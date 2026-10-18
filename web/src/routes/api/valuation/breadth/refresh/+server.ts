import { json, error } from '@sveltejs/kit';
import type { Config } from '@sveltejs/adapter-vercel';
import type { RequestHandler } from './$types';
import { refreshBreadth } from '$lib/valuation/server/breadthStore';

// Recomputes the stored market breadth from the stored candles (no Angel One call). A write, so the
// access policy refuses read-only accounts.
export const config: Config = { maxDuration: 120 };

export const POST: RequestHandler = async () => {
	try {
		return json(await refreshBreadth());
	} catch (e) {
		error(502, e instanceof Error ? e.message : 'Could not compute breadth.');
	}
};
