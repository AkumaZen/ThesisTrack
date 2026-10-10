import { listTrackerCompanies, listTrackerPreviews } from '$lib/valuation/server/masterTrackerStore';
import { trackerConfiguration } from '$lib/valuation/server/masterTrackerProvider';
import type { PageServerLoad } from './$types';
export const load: PageServerLoad = async ({ locals }) => ({
	companies: await listTrackerCompanies(), previews: await listTrackerPreviews(locals.user!.id), configuration: trackerConfiguration()
});
