// Universal load (CSR-only, see root +layout.ts) so the sectors page's data
// is ready before the router swaps this page in - no more blank
// "Loading..." flash on navigation from the dashboard/company page.
import { api } from '$lib/api';
import type { PageLoad } from './$types';

export type SectorCompany = {
	company_id: string;
	name: string;
	operating_model: string;
	broad_industry: string;
	specific_niche: string;
	status: string | null;
	last_reviewed: string | null;
	core_metrics: Record<string, number>;
};
export type Sector = {
	id: number;
	name: string;
	description: string | null;
	operating_model: string | null;
	company_count: number;
	health_counts: { on_track: number; watch_closely: number; broken: number };
	companies: SectorCompany[];
};
export type Company = { company_id: string; name: string };

export const load: PageLoad = async () => {
	const [sectorsResp, companiesResp] = await Promise.all([
		api.getSectors() as Promise<{ items: Sector[] }>,
		api.listCompanies({ page_size: 500 }) as Promise<{ items: Company[] }>
	]);
	return { sectors: sectorsResp.items, allCompanies: companiesResp.items };
};
