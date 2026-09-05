// Universal load (CSR-only, see root +layout.ts) so SvelteKit waits for the
// company's data before swapping the page in on navigation from the
// dashboard/sectors/etc. - the "click a card, page pops in abruptly" issue
// was the old onMount fetch racing the route transition; this removes that
// race entirely. Depends on params.id, so it automatically reruns when
// navigating from one company to another without a full remount.
import { api } from '$lib/api';
import type { PageLoad } from './$types';

export type KillTrigger = {
	id: number;
	label: string;
	metric_key: string | null;
	operator: string | null;
	threshold: number | null;
	severity: string;
	action: string;
	grace_periods: number;
	manual_check: boolean;
	latest_observed_value: number | null;
	latest_breached: boolean | null;
	latest_fired: boolean | null;
};
export type HealthCheck = { id: number; period: string; verdict: string; source: string; note: string; human_confirmed: boolean };
export type OtherScenario = { id: number; owner: string; label: string; status: string; last_reviewed: string };
export type ThesisData = {
	the_business?: { what_it_does: string; revenue_split: { segment: string; share_pct: number }[] };
	the_growth_engine?: string[];
	the_big_change?: { summary: string; expected_completion: string };
	proof_points?: { hard_evidence: string[] };
	why_we_believe_it?: string[];
	health_check?: { latest_quarter_review: string };
	references?: { title: string; url: string }[];
	pillar_notes?: Record<string, string[]>;
};
export type CompanyDetail = {
	company_id: string;
	name: string;
	broad_industry: string;
	specific_niche: string;
	operating_model: string;
	currency: string;
	status: string | null;
	has_own_scenario: boolean;
	has_active_override: boolean;
	current_thesis?: ThesisData;
	kill_triggers: KillTrigger[];
	health_checks: HealthCheck[];
	active_override: { to_status: string; rationale: string; actor: string } | null;
	other_scenarios: OtherScenario[];
	pending_proposals?: unknown[];
};

export const load: PageLoad = async ({ params }) => {
	const detail = (await api.getCompany(params.id)) as CompanyDetail;
	return { detail };
};
