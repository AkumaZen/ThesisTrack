<script lang="ts">
	// Ports frontend/components/facets.js's renderFacetBar().
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
	<div class="flex flex-wrap items-center gap-4 p-3 border-b border-border">
		<input
			type="search"
			placeholder="Search companies..."
			bind:value={q}
			class="flex-1 min-w-[200px] rounded-md border border-border px-3 py-1.5 text-sm"
		/>
		<label class="flex items-center gap-2 text-sm text-muted-fg shrink-0">
			<input type="checkbox" bind:checked={reviewDue} />
			Review due only
		</label>
		<div class="flex items-center gap-2 text-sm shrink-0">
			<label class="text-muted-fg" for="sort-select">Sort</label>
			<select id="sort-select" bind:value={sort} class="rounded-md border border-border px-2 py-1 text-sm">
				<option value="name">Name</option>
				<option value="last_reviewed">Last Reviewed</option>
			</select>
		</div>
	</div>
	<div class="flex flex-wrap gap-x-6 gap-y-3 p-3">
		<div class="min-w-[160px]">
			<div class="text-xs font-medium text-muted-fg mb-1.5">Industry</div>
			<div class="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto pr-1">
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
			<div class="min-w-[160px]">
				<div class="text-xs font-medium text-muted-fg mb-1.5">Niche</div>
				<div class="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto pr-1">
					{#each niches as n (n)}
						<label class="facet-chip">
							<input type="checkbox" checked={niche.includes(n)} onchange={() => (niche = toggle(niche, n))} />
							<span>{n}</span>
						</label>
					{/each}
				</div>
			</div>
		{/if}
		<div class="min-w-[160px]">
			<div class="text-xs font-medium text-muted-fg mb-1.5">Operating Model</div>
			<div class="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto pr-1">
				{#each OPERATING_MODELS as m (m)}
					<label class="facet-chip">
						<input
							type="checkbox"
							checked={operatingModel.includes(m)}
							onchange={() => (operatingModel = toggle(operatingModel, m))}
						/>
						<span>{m}</span>
					</label>
				{/each}
			</div>
		</div>
		<div class="min-w-[160px]">
			<div class="text-xs font-medium text-muted-fg mb-1.5">Status</div>
			<div class="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto pr-1">
				{#each STATUSES as s (s)}
					<label class="facet-chip">
						<input type="checkbox" checked={status.includes(s)} onchange={() => (status = toggle(status, s))} />
						<span>{s}</span>
					</label>
				{/each}
			</div>
		</div>
	</div>
</div>
