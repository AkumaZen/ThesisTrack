import type { PageServerLoad } from './$types';
import { listTracked } from '$lib/valuation/server/announcementStore';
import { pushConfigured } from '$lib/server/webPush';

// The person's own tracked companies. Each company's announcements load on demand (the API
// refreshes them from NSE), so this page renders from the database alone.
export const load: PageServerLoad = async ({ locals, url }) => {
	const tracked = (await listTracked(locals.user!.id)).map((t) => ({
		nseSymbol: t.nseSymbol,
		companyName: t.companyName
	}));
	const wanted = url.searchParams.get('symbol')?.toUpperCase() ?? '';
	return {
		tracked,
		initial: tracked.some((t) => t.nseSymbol === wanted) ? wanted : (tracked[0]?.nseSymbol ?? null),
		pushConfigured: pushConfigured()
	};
};
