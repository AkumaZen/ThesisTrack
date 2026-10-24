import { redirect } from '@sveltejs/kit';
import type { PageLoad } from './$types';
import { safeNextPath } from '$lib/auth';
import { isGuest } from '$lib/guest';

// Where a guest lands instead of a page they cannot open (see guestPageRedirect). Anyone signed in
// has no reason to be here, so they go straight on to the page they asked for.
export const load: PageLoad = async ({ parent, url }) => {
	const { user } = await parent();
	const next = safeNextPath(url.searchParams.get('next'));
	if (!isGuest(user)) redirect(307, next);
	return { next };
};
