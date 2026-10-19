import type { PageServerLoad } from './$types';
import { readBreadth } from '$lib/valuation/server/breadthStore';
import { readDmaBreadth } from '$lib/valuation/server/breadthDmaStore';

// Stored rows only. The table is the 30-session scanner-universe breadth ("Refresh breadth" recomputes
// it); the chart is the whole-market % below 50 DMA, built by the backfill and the daily cron.
export const load: PageServerLoad = async () => {
	const [rows, market] = await Promise.all([readBreadth(), readDmaBreadth()]);
	return { rows, market };
};
