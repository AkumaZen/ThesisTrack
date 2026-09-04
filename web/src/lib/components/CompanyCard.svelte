<script lang="ts">
	// Ports frontend/components/cards.js's renderCards() - a real route link
	// instead of the old drawer/window.open hack. data-sveltekit-preload-data
	// is set globally on <body> (app.html), so hovering this link prefetches
	// the company route's data before the click even resolves.
	import { STATUS_STYLES, formatMetricValue, daysSince } from '$lib/format';

	type MetricDef = { label: string; unit: string; decimals?: number };
	let {
		company,
		metricDefsByKey
	}: {
		company: {
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
		metricDefsByKey: Record<string, MetricDef>;
	} = $props();

	let style = $derived(STATUS_STYLES[company.status ?? ''] ?? STATUS_STYLES.on_track);
	let since = $derived(daysSince(company.last_reviewed));
	let metricEntries = $derived(Object.entries(company.core_metrics ?? {}).slice(0, 4));
</script>

<a
	href="/company/{company.company_id}"
	class="text-left rounded-xl border border-border bg-surface p-4 hover:shadow-md transition-shadow relative block"
>
	{#if company.has_active_override}
		<span
			class="absolute top-3 right-3 text-[10px] font-semibold uppercase tracking-wide text-danger bg-danger/10 px-2 py-0.5 rounded-full ring-1 ring-danger/20"
			>Override</span
		>
	{/if}
	<div class="flex items-center gap-2">
		<span class="inline-block h-2 w-2 rounded-full {style.dot}"></span>
		<span class="text-xs font-medium {style.pill} px-2 py-0.5 rounded-full ring-1">{style.label}</span>
	</div>
	<div class="mt-2 font-semibold text-fg">{company.name}</div>
	<div class="text-xs text-muted-fg">{company.broad_industry} &gt; {company.specific_niche}</div>
	<div class="text-xs text-muted-fg mt-1">
		{company.operating_model} &middot; {since === null ? 'never reviewed' : `${since}d since review`}
	</div>
	{#if metricEntries.length}
		<div class="grid grid-cols-2 gap-x-3 gap-y-1 mt-2">
			{#each metricEntries as [key, value] (key)}
				{@const def = metricDefsByKey[key]}
				<div class="text-xs">
					<span class="text-muted-fg">{def?.label ?? key}</span>
					<span class="block font-mono font-medium text-fg">{formatMetricValue(value, def?.unit ?? 'ratio', def?.decimals)}</span>
				</div>
			{/each}
		</div>
	{:else}
		<div class="text-xs text-muted-fg mt-2">No metrics yet</div>
	{/if}
</a>
