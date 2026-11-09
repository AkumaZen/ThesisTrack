import type { PageServerLoad } from './$types';
import { readBreadth, readBreadthComputedAt } from '$lib/valuation/server/breadthStore';
import { readDmaBreadth } from '$lib/valuation/server/breadthDmaStore';
import { isProvisionalBreadth } from '$lib/valuation/livePass';

// Stored rows only. The table is the 30-session scanner-universe breadth; the chart is the whole-market
// % below 50 DMA. The background price pass and "Refresh breadth" recompute both from live quotes during
// the session, the daily cron makes them final. A day is "live" while its stored figures were computed
// before 16:00 IST on that same day (derived from the stored time: no separate flag is kept).
export const load: PageServerLoad = async () => {
	const [rows, market, computedAt] = await Promise.all([readBreadth(), readDmaBreadth(), readBreadthComputedAt()]);
	const newest = rows.at(-1);
	const liveDay = newest && isProvisionalBreadth(newest.asOf, computedAt) ? newest.asOf : null;
	const lastPoint = market.points.at(-1);
	const liveMarketDay = lastPoint && isProvisionalBreadth(lastPoint.asOf, market.status.computedAt) ? lastPoint.asOf : null;
	return { rows, market, computedAt, liveDay, liveMarketDay };
};
