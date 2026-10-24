import { redirect } from '@sveltejs/kit';
import type { LayoutLoad } from './$types';
import { guestPageRedirect, isGuest } from '$lib/guest';

// Client-rendered: the thesis pages load their data in universal load()s through $lib/api's
// plain fetch, which only carries the session cookie from the browser. Server loads
// (+page.server.ts, used by the valuation tools and the account pages) still run on the server.
export const ssr = false;

// The hook guards every full page request; this repeats the guest page rule for client-side
// navigation, which can reach a page without asking the server first.
export const load: LayoutLoad = ({ data, url }) => {
	if (isGuest(data.user)) {
		const to = guestPageRedirect(url.pathname, url.search);
		if (to) redirect(307, to);
	}
	return data;
};
