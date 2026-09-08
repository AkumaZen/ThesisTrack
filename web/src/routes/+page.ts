// Universal load (CSR-only per +layout.ts) so SvelteKit waits for this data
// before swapping the page in - no more blank "Loading..." flash when
// navigating here, since the router holds the old page on screen until
// this resolves. Auth is a client-side bearer token (session.svelte.ts),
// which is why this can't be a +page.server.ts.
import { api } from '$lib/api';
import type { PageLoad } from './$types';

export type Trackable = {
	id: number;
	label: string;
	severity: string;
	manual_check: boolean;
	metric_key: string | null;
	operator: string | null;
	threshold: number | null;
	latest_fired: boolean | null;
};
export type GuidanceSummary = { id: number; block_key: string; note: string; created_at: string };
export type CompanyScenario = {
	owner: string;
	status: string | null;
	last_reviewed: string | null;
	has_active_override: boolean;
	core_metrics: Record<string, number>;
	trackables: Trackable[];
	guidance: GuidanceSummary[];
};
export type Company = {
	company_id: string;
	name: string;
	broad_industry: string;
	specific_niche: string;
	operating_model: string;
	status: string | null;
	last_reviewed: string | null;
	has_active_override: boolean;
	core_metrics: Record<string, number>;
	scenarios: CompanyScenario[];
};
export type MetricDef = { metric_key: string; label: string; unit: string; decimals?: number };

export const load: PageLoad = async () => {
	const [metrics, resp] = await Promise.all([
		api.getMetrics() as Promise<MetricDef[]>,
		api.listCompanies({ sort: 'name', page_size: 200 }) as Promise<{ items: Company[] }>
	]);
	return {
		companies: resp.items,
		metricDefsByKey: Object.fromEntries(metrics.map((m) => [m.metric_key, m])) as Record<string, MetricDef>
	};
};
