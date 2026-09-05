<script lang="ts">
	// Ports the dashboard portion of frontend/app.js (loadCards/refreshCompanies)
	// + renderCards/renderFacetBar/renderHeaderStats. Initial data now comes
	// from +page.ts's load() (see that file for why) instead of onMount, so
	// SvelteKit holds the previous page on screen until this is ready -
	// no blank "Loading..." flash on navigation.
	import HeaderStats from '$lib/components/HeaderStats.svelte';
	import CompanyCard from '$lib/components/CompanyCard.svelte';
	import type { PageData } from './$types';
	import type { Company, MetricDef } from './+page';

	let { data }: { data: PageData } = $props();

	let companies: Company[] = $derived(data.companies);
	let metricDefsByKey: Record<string, MetricDef> = $derived(data.metricDefsByKey);
</script>

<div class="flex items-center justify-between">
	<div class="flex-1"><HeaderStats {companies} /></div>
	<a href="/ingest" class="text-sm px-3 py-1.5 rounded-md bg-fg text-bg hover:brightness-90 shrink-0 ml-3">+ New Company</a>
</div>

{#if !companies.length}
	<div class="text-center text-muted-fg py-16">No companies yet.</div>
{:else}
	<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
		{#each companies as company (company.company_id)}
			<CompanyCard {company} {metricDefsByKey} />
		{/each}
	</div>
{/if}
