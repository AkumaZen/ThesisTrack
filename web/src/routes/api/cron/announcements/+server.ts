import { json } from '@sveltejs/kit';
import type { Config } from '@sveltejs/adapter-vercel';
import type { RequestHandler } from './$types';
import { requireCronSecret } from '$lib/server/cron';
import { runAnnouncementCheck } from '$lib/valuation/server/announcementJob';

// Called every minute by an external scheduler (cron-job.org) with `Authorization: Bearer $CRON_SECRET`:
// Vercel Hobby crons run once a day, which is too slow for announcement alerts.
export const config: Config = { maxDuration: 60 };

const run: RequestHandler = async ({ request }) => {
	requireCronSecret(request);
	return json(await runAnnouncementCheck());
};

export const GET = run;
export const POST = run;
