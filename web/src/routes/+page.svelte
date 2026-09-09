<script lang="ts">
	// Ports the dashboard portion of frontend/app.js (loadCards/refreshCompanies)
	// + renderCards/renderFacetBar/renderHeaderStats. Initial data now comes
	// from +page.ts's load() (see that file for why) instead of onMount, so
	// SvelteKit holds the previous page on screen until this is ready -
	// no blank "Loading..." flash on navigation.
	import HeaderStats from '$lib/components/HeaderStats.svelte';
	import CompanyCard from '$lib/components/CompanyCard.svelte';
	import { filterCompaniesByName } from '$lib/companySearch';
	import type { PageData } from './$types';
	import type { Company, MetricDef } from './+page';

	let { data }: { data: PageData } = $props();

	let companies: Company[] = $derived(data.companies);
	let metricDefsByKey: Record<string, MetricDef> = $derived(data.metricDefsByKey);
	let companyQuery = $state('');
	let filteredCompanies = $derived(filterCompaniesByName(companies, companyQuery));
</script>

<div class="flex items-center justify-between">
	<div class="flex-1"><HeaderStats {companies} /></div>
	<a href="/ingest" class="text-sm px-3 py-1.5 rounded-md bg-fg text-bg hover:brightness-90 shrink-0 ml-3">+ New Company</a>
</div>

<div class="my-5 rounded-xl border border-border bg-surface p-3">
	<div class="flex items-center gap-3">
		<div class="relative min-w-0 flex-1">
			<svg
				aria-hidden="true"
				class="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-fg"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="1.8"
			>
				<circle cx="11" cy="11" r="7" />
				<path d="m20 20-4-4" stroke-linecap="round" />
			</svg>
			<label class="sr-only" for="company-search">Search companies by name</label>
			<input
				id="company-search"
				type="search"
				bind:value={companyQuery}
				onkeydown={(event) => {
					if (event.key === 'Escape') companyQuery = '';
				}}
				placeholder="Search companies by name..."
				autocomplete="off"
				class="w-full rounded-lg border border-border bg-bg py-2.5 pl-10 pr-10 text-sm outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20"
			/>
			{#if companyQuery}
				<button
					type="button"
					onclick={() => (companyQuery = '')}
					aria-label="Clear company search"
					class="absolute right-2 top-1/2 -translate-y-1/2 rounded-md px-2 py-1 text-lg leading-none text-muted-fg hover:bg-surface-3 hover:text-fg"
				>&times;</button>
			{/if}
		</div>
		<div class="hidden shrink-0 text-xs text-muted-fg sm:block" aria-live="polite">
			{#if companyQuery.trim()}
				{filteredCompanies.length} of {companies.length} companies
			{:else}
				{companies.length} companies
			{/if}
		</div>
	</div>
</div>

{#if !companies.length}
	<div class="text-center text-muted-fg py-16">No companies yet.</div>
{:else if !filteredCompanies.length}
	<div class="rounded-xl border border-dashed border-border py-16 text-center">
		<div class="font-medium">No companies found</div>
		<div class="mt-1 text-sm text-muted-fg">Try another company name or clear the search.</div>
		<button type="button" onclick={() => (companyQuery = '')} class="mt-4 rounded-md border border-border px-3 py-1.5 text-sm hover:bg-surface-3">Clear search</button>
	</div>
{:else}
	<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
		{#each filteredCompanies as company (company.company_id)}
			<CompanyCard {company} {metricDefsByKey} />
		{/each}
	</div>
{/if}
