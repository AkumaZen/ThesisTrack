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

export type Trackable = {
	id: number;
	label: string;
	severity: string;
	manual_check: boolean;
	metric_key: string | null;
	operator: string | null;
	threshold: number | null;
	latest_fired: boolean | null;
	company_id: string;
	company_name: string;
};

export const load: PageLoad = async () => {
	const [proposals, trackables] = await Promise.all([
		api.listProposals('pending') as Promise<Proposal[]>,
		api.listTrackables() as Promise<Trackable[]>
	]);
	return { proposals, trackables };
};
