import { error, redirect } from '@sveltejs/kit';
import type { PageLoad } from './$types';
import { isGuest, lockedFeatureByKey } from '$lib/guest';

export const load: PageLoad = async ({ params, parent }) => {
	const feature = lockedFeatureByKey(params.feature);
	if (!feature) error(404, 'Not found');
	// Someone signed in has the real thing, so the preview just points there.
	const { user } = await parent();
	if (user && !isGuest(user)) redirect(307, feature.pages[0]);
	return { feature };
};
