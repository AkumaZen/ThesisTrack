import { json } from '@sveltejs/kit';
import type { Config } from '@sveltejs/adapter-vercel';
import type { RequestHandler } from './$types';
import { requireCronSecret } from '$lib/server/cron';
import { warmAllSectors } from '$lib/valuation/server/sectorRotationScheduler';

// Vercel stand-in for the in-process 2-hour cache warmer (see hooks.server.ts). Every symbol is
// cached as soon as it is fetched, so a run cut short by the time limit still leaves the caches
// warmer and the next run carries on from there.
export const config: Config = { maxDuration: 300 };

export const GET: RequestHandler = async ({ request }) => {
	requireCronSecret(request);
	const started = Date.now();
	await warmAllSectors();
	return json({ ok: true, ms: Date.now() - started });
};
