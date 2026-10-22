import { json } from '@sveltejs/kit';
import { dev } from '$app/environment';
import type { Config } from '@sveltejs/adapter-vercel';
import type { RequestHandler } from './$types';
import { requireCronSecret } from '$lib/server/cron';
import { liveMarketIntel, runAnnouncementCheck } from '$lib/valuation/server/announcementJob';
import { runIntradaySlice, SLICE_BUDGET_MS } from '$lib/valuation/server/intradayPrices';

// Called every minute by an external scheduler (cron-job.org) with `Authorization: Bearer $CRON_SECRET`:
// Vercel Hobby crons run once a day, which is too slow for announcement alerts.
export const config: Config = { maxDuration: 60 };

// After the alerts, the same call works one slice of the background price pass (see
// intradayPrices.ts) with whatever time is left, so alerts are never delayed by it and it never
// pushes the call past its time limit.
const TOTAL_BUDGET_MS = 50_000;
const MIN_SLICE_MS = 5_000;

const run: RequestHandler = async ({ request, url }) => {
	requireCronSecret(request);
	const started = Date.now();
	const summary = await runAnnouncementCheck({ marketIntel: liveMarketIntel });
	const left = TOTAL_BUDGET_MS - (Date.now() - started);
	// Local testing only: `?at=<ISO time>` pretends it is that moment (never honoured in production).
	const at = dev ? Date.parse(url.searchParams.get('at') ?? '') : NaN;
	const prices =
		left >= MIN_SLICE_MS
			? await runIntradaySlice(Number.isNaN(at) ? {} : { now: () => new Date(at) }, Math.min(SLICE_BUDGET_MS, left))
			: null;
	return json({ ...summary, prices });
};

export const GET = run;
export const POST = run;
