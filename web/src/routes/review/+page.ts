// Universal load (CSR-only, see root +layout.ts) - same reasoning as the
// dashboard/company/sectors +page.ts files: no more blank "Loading..."
// flash when navigating here, SvelteKit holds the previous page until
// this resolves.
import { api } from '$lib/api';
import type { PageLoad } from './$types';

export type Proposal = {
	id: number;
	company_id: string;
	period: string | null;
	proposed_status: string;
	source: string;
	rationale: string;
	evidence: { reasoning_chain?: string[] } | null;
	state: string;
	model_name: string | null;
	created_at: string;
};

export const load: PageLoad = async () => {
	return { proposals: (await api.listProposals('pending')) as Proposal[] };
};
