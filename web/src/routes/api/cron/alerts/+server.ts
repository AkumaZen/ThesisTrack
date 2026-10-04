import { json } from '@sveltejs/kit';
import type { Config } from '@sveltejs/adapter-vercel';
import type { RequestHandler } from './$types';
import { requireCronSecret } from '$lib/server/cron';
import { runPriceChecks } from '$lib/valuation/server/alertChecks';

// Vercel stand-in for the in-process 10-minute price-vs-fair-value check (see hooks.server.ts).
// runPriceChecks skips itself outside market hours.
export const config: Config = { maxDuration: 120 };

export const GET: RequestHandler = async ({ request }) => {
	requireCronSecret(request);
	return json(await runPriceChecks());
};
