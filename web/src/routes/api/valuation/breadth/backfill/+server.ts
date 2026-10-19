import { json, error } from '@sveltejs/kit';
import type { Config } from '@sveltejs/adapter-vercel';
import type { RequestHandler } from './$types';
import { markAllStale, runBreadthBackfill } from '$lib/valuation/server/breadthDmaStore';

// Admin button on the breadth page: one resumable slice of the whole-market history backfill. The
// page calls it again until `finished`. Admin only (access.ts). The slice stops starting symbols
// after 200 s, well inside the 300 s function limit, and saves progress as it goes.
export const config: Config = { maxDuration: 300 };

export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json().catch(() => ({}))) as { retryFailed?: boolean; rebuild?: boolean };
	try {
		if (body.rebuild) await markAllStale();
		return json(await runBreadthBackfill({ budgetMs: 200_000, retryFailed: Boolean(body.retryFailed) }));
	} catch (e) {
		error(502, e instanceof Error ? e.message : 'Could not run the backfill.');
	}
};
