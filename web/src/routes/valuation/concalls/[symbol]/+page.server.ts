import { error } from '@sveltejs/kit';
import { companyPanel } from '$lib/valuation/server/concallPanel';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
	const panel = await companyPanel(params.symbol.toUpperCase());
	if (!panel) error(404, 'This company is not in the Master Tracker.');
	return { panel };
};
