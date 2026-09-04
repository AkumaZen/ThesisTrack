<script lang="ts">
	// Ports frontend/components/cards.js's renderCards() - a real route link
	// instead of the old drawer/window.open hack. data-sveltekit-preload-data
	// is set globally on <body> (app.html), so hovering this link prefetches
	// the company route's data before the click even resolves.
	import { OPERATING_MODEL_LABELS, STATUS_STYLES, formatMetricValue, daysSince } from '$lib/format';

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
	// An odd count in a 2-col grid otherwise leaves a dangling empty cell -
	// let the last metric span the full row so the grid reads as complete.
	let lastIsOdd = $derived(metricEntries.length % 2 === 1);
</script>

<a
	href="/company/{company.company_id}"
	class="text-left rounded-xl border border-border bg-surface p-4 hover:shadow-md transition-shadow relative flex flex-col block"
>
	{#if company.has_active_override}
		<span
			class="absolute top-3 right-3 text-[10px] font-semibold uppercase tracking-wide text-danger bg-danger/10 px-2 py-0.5 rounded-full ring-1 ring-danger/20"
			>Override</span
		>
	{/if}

	<!-- Identity: status is the triage signal, name is the primary reading
	     target - tightly coupled to each other, loosely separated from the
	     metadata group below. -->
	<div class="flex items-center gap-2">
		<span class="inline-block h-2 w-2 rounded-full {style.dot}"></span>
		<span class="text-xs font-medium {style.pill} px-2 py-0.5 rounded-full ring-1">{style.label}</span>
	</div>
	<div class="mt-2.5 font-semibold text-fg leading-snug">{company.name}</div>

	<!-- Classification metadata: one tight group, two facts that belong
	     together (what it is, how stale the review is). -->
	<div class="mt-1 space-y-0.5">
		<div class="text-xs text-muted-fg">{company.broad_industry} &gt; {company.specific_niche}</div>
		<div class="text-xs text-muted-fg">
			{OPERATING_MODEL_LABELS[company.operating_model] ?? company.operating_model} &middot; {since === null
				? 'never reviewed'
				: `${since}d since review`}
		</div>
	</div>

	<!-- Evidence: the hard numbers this card exists to surface. A hairline
	     + generous top padding marks the real group boundary that the rest
	     of the card only implies through weight. -->
	{#if metricEntries.length}
		<div class="mt-3.5 pt-3 border-t border-border grid grid-cols-2 gap-x-4 gap-y-2.5">
			{#each metricEntries as [key, value], i (key)}
				{@const def = metricDefsByKey[key]}
				<div class="text-xs" class:col-span-2={lastIsOdd && i === metricEntries.length - 1}>
					<span class="text-muted-fg">{def?.label ?? key}</span>
					<span class="block font-mono font-medium text-fg mt-0.5">{formatMetricValue(value, def?.unit ?? 'ratio', def?.decimals)}</span>
				</div>
			{/each}
		</div>
	{:else}
		<div class="mt-3.5 pt-3 border-t border-border text-xs text-muted-fg">No metrics yet</div>
	{/if}
</a>
