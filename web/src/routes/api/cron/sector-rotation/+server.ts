import { json } from '@sveltejs/kit';
import type { Config } from '@sveltejs/adapter-vercel';
import type { RequestHandler } from './$types';
import { requireCronSecret } from '$lib/server/cron';
import { warmAllSectors } from '$lib/valuation/server/sectorRotationScheduler';
import { holdPriceLease, markPricesUpdated } from '$lib/valuation/server/intradayPrices';
import { refreshBreadth } from '$lib/valuation/server/breadthStore';
import { appendDailyBreadth } from '$lib/valuation/server/breadthDmaStore';
import { runScanSnapshots } from '$lib/valuation/server/scanSnapshotJob';

// Vercel stand-in for the in-process price refresh (see hooks.server.ts). Hobby plan: once each
// weekday after the close (vercel.json; the moments are listed in refreshSlots.ts). Every symbol is
// cached as soon as it is fetched, so a run cut short by the time limit still leaves the caches
// warmer and the next run carries on from there.
export const config: Config = { maxDuration: 300 };

export const GET: RequestHandler = async ({ request }) => {
	requireCronSecret(request);
	const started = Date.now();
	// Same lease as the background price passes, so the two never run at once.
	const release = await holdPriceLease();
	try {
		await warmAllSectors();
		await markPricesUpdated().catch(() => {});
	} finally {
		await release();
	}
	// With the prices fresh, update the stored market breadth and the saved scans' daily snapshots. Each is
	// best effort: neither may make the price refresh report a failure.
	const breadth = await refreshBreadth().catch((e) => ({ error: e instanceof Error ? e.message : String(e) }));
	// The whole-market % below 50 DMA: append today's close for every stored symbol and recompute.
	const breadthAll = await appendDailyBreadth().catch((e) => ({ error: e instanceof Error ? e.message : String(e) }));
	const scans = await runScanSnapshots().catch((e) => ({ error: e instanceof Error ? e.message : String(e) }));
	return json({ ok: true, ms: Date.now() - started, breadth, breadthAll, scans });
};
