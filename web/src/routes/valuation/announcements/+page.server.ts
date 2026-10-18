import type { PageServerLoad } from './$types';
import { parseFeedFilters } from '$lib/valuation/announcementScans';
import { feedCoverage, listFeed, listKeywords, trendingWords } from '$lib/valuation/server/marketIntelStore';

// The market-wide NSE announcement feed, read from our own table (the poller keeps it filled).
export const load: PageServerLoad = async ({ url, locals }) => {
	const filters = parseFeedFilters(url.searchParams);
	const [feed, keywords, trending, coverage] = await Promise.all([
		listFeed(filters),
		listKeywords(locals.user!.id),
		trendingWords(new Date()),
		feedCoverage()
	]);
	return {
		filters: { ...filters, scan: filters.scan?.key ?? null },
		items: feed.items,
		hasMore: feed.hasMore,
		keywords,
		trending,
		coverage
	};
};
