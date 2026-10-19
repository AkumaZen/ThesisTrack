import { json } from '@sveltejs/kit';
import type { Config } from '@sveltejs/adapter-vercel';
import type { RequestHandler } from './$types';
import { requireCronSecret } from '$lib/server/cron';
import { markAllStale, runBreadthBackfill } from '$lib/valuation/server/breadthDmaStore';

// One resumable slice of the whole-market breadth history backfill, for scripts and local runs
// (scripts/breadth-backfill.mjs calls it in a loop). ?budget=<ms> caps the slice (default 240000,
// at most 270000 to stay inside maxDuration), ?retry=1 also retries failed symbols, ?rebuild=1 marks
// every stored symbol stale first so all of them are refetched.
export const config: Config = { maxDuration: 300 };

export const GET: RequestHandler = async ({ request, url }) => {
	requireCronSecret(request);
	const budgetMs = Math.min(270_000, Math.max(5_000, Number(url.searchParams.get('budget')) || 240_000));
	if (url.searchParams.get('rebuild') === '1') await markAllStale();
	return json(await runBreadthBackfill({ budgetMs, retryFailed: url.searchParams.get('retry') === '1' }));
};
