import { json } from '@sveltejs/kit';
import type { Config } from '@sveltejs/adapter-vercel';
import type { RequestHandler } from './$types';
import { requireCronSecret } from '$lib/server/cron';
import { runMarketIntel } from '$lib/valuation/server/marketIntelJob';

// Tops up the market-wide NSE feeds on its own (the one-minute announcement poller does the same
// as part of its run). Handy for a first fill or a manual catch-up: each call does as many
// one-day units as fit in the budget and the next call continues. `Authorization: Bearer $CRON_SECRET`.
export const config: Config = { maxDuration: 60 };

const run: RequestHandler = async ({ request }) => {
	requireCronSecret(request);
	return json(await runMarketIntel({}, 45_000));
};

export const GET = run;
export const POST = run;
