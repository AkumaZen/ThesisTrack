<script lang="ts">
	// Ports frontend/components/facets.js's renderFacetBar().
	import { OPERATING_MODEL_LABELS, STATUS_STYLES } from '$lib/format';

	const OPERATING_MODELS = ['factory', 'subscription', 'money_lending', 'retail_stores', 'services'];
	const STATUSES = ['on_track', 'watch_closely', 'broken'];

	type Industry = { name: string; niches: { name: string }[] };
	let {
		taxonomy,
		q = $bindable(''),
		reviewDue = $bindable(false),
		sort = $bindable('name'),
		broadIndustry = $bindable<string[]>([]),
		niche = $bindable<string[]>([]),
		operatingModel = $bindable<string[]>([]),
		status = $bindable<string[]>([])
	}: {
		taxonomy: Industry[];
		q?: string;
		reviewDue?: boolean;
		sort?: string;
		broadIndustry?: string[];
		niche?: string[];
		operatingModel?: string[];
		status?: string[];
	} = $props();

	let niches = $derived.by(() => {
		const source = broadIndustry.length ? taxonomy.filter((i) => broadIndustry.includes(i.name)) : taxonomy;
		return source.flatMap((i) => i.niches.map((n) => n.name));
	});

	function toggle(list: string[], value: string): string[] {
		return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
	}
</script>

<div class="rounded-lg border border-border bg-surface mb-4">
	<div class="flex flex-wrap items-center gap-3 p-3 border-b border-border">
		<div class="relative flex-1 min-w-[220px]">
			<svg
				class="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-fg"
				viewBox="0 0 20 20"
				fill="none"
				stroke="currentColor"
				stroke-width="1.6"
			>
				<circle cx="9" cy="9" r="6" />
				<path d="M17 17l-4-4" stroke-linecap="round" />
			</svg>
			<input
				type="search"
				placeholder="Search companies..."
				bind:value={q}
				class="w-full rounded-md border border-border pl-8 pr-3 py-1.5 text-sm"
			/>
		</div>
		<label class="flex items-center gap-1.5 text-sm text-muted-fg shrink-0 whitespace-nowrap">
			<input type="checkbox" bind:checked={reviewDue} />
			Review due only
		</label>
		<div class="flex items-center gap-1.5 text-sm shrink-0">
			<label class="text-muted-fg" for="sort-select">Sort</label>
			<select id="sort-select" bind:value={sort} class="rounded-md border border-border pl-2 pr-7 py-1 text-sm">
				<option value="name">Name</option>
				<option value="last_reviewed">Last Reviewed</option>
			</select>
		</div>
	</div>
	<div class="flex flex-wrap gap-x-8 gap-y-4 p-3">
		<div class="min-w-[180px]">
			<div class="facet-group-label">Industry</div>
			<div class="flex flex-wrap gap-1.5">
				{#each taxonomy as industry (industry.name)}
					<label class="facet-chip">
						<input
							type="checkbox"
							checked={broadIndustry.includes(industry.name)}
							onchange={() => (broadIndustry = toggle(broadIndustry, industry.name))}
						/>
						<span>{industry.name}</span>
					</label>
				{/each}
			</div>
		</div>
		{#if niches.length}
			<div class="min-w-[180px]">
				<div class="facet-group-label">Niche</div>
				<div class="flex flex-wrap gap-1.5">
					{#each niches as n (n)}
						<label class="facet-chip">
							<input type="checkbox" checked={niche.includes(n)} onchange={() => (niche = toggle(niche, n))} />
							<span>{n}</span>
						</label>
					{/each}
				</div>
			</div>
		{/if}
		<div class="min-w-[180px]">
			<div class="facet-group-label">Operating Model</div>
			<div class="flex flex-wrap gap-1.5">
				{#each OPERATING_MODELS as m (m)}
					<label class="facet-chip">
						<input
							type="checkbox"
							checked={operatingModel.includes(m)}
							onchange={() => (operatingModel = toggle(operatingModel, m))}
						/>
						<span>{OPERATING_MODEL_LABELS[m]}</span>
					</label>
				{/each}
			</div>
		</div>
		<div class="min-w-[180px]">
			<div class="facet-group-label">Status</div>
			<div class="flex flex-wrap gap-1.5">
				{#each STATUSES as s (s)}
					{@const style = STATUS_STYLES[s]}
					<label class="facet-chip">
						<input type="checkbox" checked={status.includes(s)} onchange={() => (status = toggle(status, s))} />
						<span class="inline-block h-1.5 w-1.5 rounded-full {style.dot}"></span>
						<span>{style.label}</span>
					</label>
				{/each}
			</div>
		</div>
	</div>
</div>
