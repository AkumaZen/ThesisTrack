// Universal load (CSR-only, see root +layout.ts) - fetches the default
// filter view (status=open) plus the companies list before the router
// swaps this page in, so navigating to Guidance no longer flashes
// "Loading...". Changing a filter afterwards still refetches directly
// (see refresh() in +page.svelte) rather than round-tripping through the
// URL/load() - these filters aren't meant to be bookmarkable state.
import { api } from '$lib/api';
import type { PageLoad } from './$types';

export type Guidance = {
	id: number;
	company_id: string;
	company_name: string | null;
	block_key: string;
	note: string;
	status: string;
	created_by: string;
	created_at: string;
	resolved_by: string | null;
	resolved_at: string | null;
};
export type Company = { company_id: string; name: string };

export const load: PageLoad = async () => {
	const [items, companiesResp] = await Promise.all([
		api.listGuidance({ status: 'open' }) as Promise<Guidance[]>,
		api.listCompanies({ page_size: 200 }) as Promise<{ items: Company[] }>
	]);
	return { items, companies: companiesResp.items };
};
