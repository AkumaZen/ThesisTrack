<script lang="ts">
	// Ports the dashboard portion of frontend/app.js (loadCards/refreshCompanies)
	// + renderCards/renderFacetBar/renderHeaderStats.
	import { onMount } from 'svelte';
	import { api } from '$lib/api';
	import HeaderStats from '$lib/components/HeaderStats.svelte';
	import FacetBar from '$lib/components/FacetBar.svelte';
	import CompanyCard from '$lib/components/CompanyCard.svelte';

	type Company = {
		company_id: string;
		name: string;
		broad_industry: string;
		specific_niche: string;
		operating_model: string;
		status: string | null;
		last_reviewed: string | null;
		has_active_override: boolean;
		core_metrics: Record<string, number>;
	};
	type MetricDef = { metric_key: string; label: string; unit: string; decimals?: number };

	let companies = $state<Company[]>([]);
	let taxonomy = $state<{ name: string; niches: { name: string }[] }[]>([]);
	let metricDefsByKey = $state<Record<string, MetricDef>>({});
	let loading = $state(true);
	let error = $state('');

	let q = $state('');
	let reviewDue = $state(false);
	let sort = $state('name');
	let broadIndustry = $state<string[]>([]);
	let niche = $state<string[]>([]);
	let operatingModel = $state<string[]>([]);
	let status = $state<string[]>([]);

	async function refresh() {
		loading = true;
		error = '';
		try {
			const resp = (await api.listCompanies({
				q: q || undefined,
				review_due: reviewDue || undefined,
				sort,
				broad_industry: broadIndustry,
				niche,
				operating_model: operatingModel,
				status,
				page_size: 200
			})) as { items: Company[] };
			companies = resp.items;
		} catch (e) {
			error = String(e);
		} finally {
			loading = false;
		}
	}

	onMount(async () => {
		const [tax, metrics] = await Promise.all([
			api.getTaxonomy() as Promise<{ name: string; niches: { name: string }[] }[]>,
			api.getMetrics() as Promise<MetricDef[]>
		]);
		taxonomy = tax;
		metricDefsByKey = Object.fromEntries(metrics.map((m) => [m.metric_key, m]));
		await refresh();
	});

	$effect(() => {
		// re-fetch whenever any filter changes
		[q, reviewDue, sort, broadIndustry, niche, operatingModel, status];
		if (!loading) refresh();
	});
</script>

<HeaderStats {companies} />
<FacetBar {taxonomy} bind:q bind:reviewDue bind:sort bind:broadIndustry bind:niche bind:operatingModel bind:status />

{#if error}
	<div class="text-center text-danger py-16">{error}</div>
{:else if loading && !companies.length}
	<div class="text-center text-muted-fg py-16">Loading...</div>
{:else if !companies.length}
	<div class="text-center text-muted-fg py-16">No companies match these filters.</div>
{:else}
	<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
		{#each companies as company (company.company_id)}
			<CompanyCard {company} {metricDefsByKey} />
		{/each}
	</div>
{/if}
