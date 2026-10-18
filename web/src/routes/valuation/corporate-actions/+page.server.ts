import type { PageServerLoad } from './$types';
import { istDay } from '$lib/valuation/boardMeetings';
import { ACTION_LABELS, UPCOMING_PAGE_SIZE, type ActionKind } from '$lib/valuation/corporateActions';
import { lastStoredCloses, listUpcomingActions } from '$lib/valuation/server/marketIntelStore';

const KINDS = Object.keys(ACTION_LABELS) as ActionKind[];

// Corporate actions going ex on or after today, from the NSE feed the poller stores.
export const load: PageServerLoad = async ({ url }) => {
	const kindParam = url.searchParams.get('kind');
	const kind = KINDS.find((k) => k === kindParam) ?? null;
	const page = Math.min(Math.max(Number.parseInt(url.searchParams.get('page') ?? '1', 10) || 1, 1), 200);
	const today = istDay(new Date());
	const { items, hasMore } = await listUpcomingActions(today, kind, page, UPCOMING_PAGE_SIZE);
	// Dividend yield of the stored price, for the dividends on this page.
	const closes = await lastStoredCloses([...new Set(items.filter((i) => i.kind === 'dividend').map((i) => i.nseSymbol))]);
	return {
		today,
		kind,
		page,
		hasMore,
		items: items.map((i) => {
			const price = closes.get(i.nseSymbol);
			return { ...i, yieldPct: i.kind === 'dividend' && i.amount != null && price ? Math.round((i.amount / price) * 10_000) / 100 : null };
		})
	};
};
