<script lang="ts">
	// Ports frontend/components/cards.js's renderCards() - a real route link
	// instead of the old drawer/window.open hack. data-sveltekit-preload-data
	// is set globally on <body> (app.html), so hovering this link prefetches
	// the company route's data before the click even resolves.
	import { OPERATING_MODEL_LABELS, STATUS_STYLES, formatMetricValue, daysSince } from '$lib/format';
	import { session } from '$lib/session.svelte';
	import type { CompanyScenario } from '../../routes/+page';

	function blockLabel(key: string) {
		if (key === 'general') return 'General';
		return key
			.split('_')
			.map((w) => w[0].toUpperCase() + w.slice(1))
			.join(' ');
	}

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
			scenarios: CompanyScenario[];
		};
		metricDefsByKey: Record<string, MetricDef>;
	} = $props();

	// Cycle through every analyst's take on this company right on the card,
	// with no navigation - mine first (if I have one), then everyone else's,
	// same order the server already sorted `scenarios` in.
	let scenarios = $derived(company.scenarios ?? []);
	let cycleIndex = $state(0);
	let active = $derived<CompanyScenario | null>(scenarios[cycleIndex] ?? null);
	let isMine = $derived(active?.owner === session.email);

	function nextScenario(e: MouseEvent) {
		e.preventDefault();
		e.stopPropagation();
		cycleIndex = (cycleIndex + 1) % scenarios.length;
	}

	let style = $derived(STATUS_STYLES[active?.status ?? ''] ?? STATUS_STYLES.on_track);
	let since = $derived(daysSince(active?.last_reviewed ?? null));
	let metricEntries = $derived(Object.entries(active?.core_metrics ?? {}).slice(0, 4));
	let guidanceNotes = $derived(active?.guidance ?? []);
	let trackables = $derived(active?.trackables ?? []);
	// An odd count in a 2-col grid otherwise leaves a dangling empty cell -
	// let the last metric span the full row so the grid reads as complete.
	let lastIsOdd = $derived(metricEntries.length % 2 === 1);
</script>

<a
	href={active && !isMine
		? `/company/${company.company_id}?owner=${encodeURIComponent(active.owner)}`
		: `/company/${company.company_id}`}
	class="text-left rounded-xl border border-border bg-surface p-4 hover:shadow-md transition-shadow relative flex flex-col block"
>
	<div class="flex items-center justify-between gap-2">
		<div class="flex items-center gap-2 min-w-0">
			<span class="inline-block h-2 w-2 rounded-full {style.dot} shrink-0"></span>
			<span class="text-xs font-medium {style.pill} px-2 py-0.5 rounded-full ring-1 shrink-0">{style.label}</span>
		</div>
		<div class="flex items-center gap-1.5 shrink-0">
			{#if active?.has_active_override}
				<span
					class="text-[10px] font-semibold uppercase tracking-wide text-danger bg-danger/10 px-2 py-0.5 rounded-full ring-1 ring-danger/20"
					>Override</span
				>
			{/if}
			{#if scenarios.length > 1}
				<span
					class="text-[10px] px-1.5 py-0.5 rounded-full bg-surface-2 ring-1 ring-border text-muted-fg max-w-[9rem] truncate"
					title={isMine ? 'Your thesis' : `${active?.owner}'s thesis - read only`}>{isMine ? 'You' : active?.owner}</span
				>
				<button
					type="button"
					onclick={nextScenario}
					title="Show the next analyst's take on this company"
					aria-label="Show next analyst's take"
					class="text-xs h-5 w-5 flex items-center justify-center rounded-full border border-border hover:bg-surface-3 cursor-pointer"
					>&rarr;</button
				>
			{/if}
		</div>
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

	<!-- Guidance: what to look into or keep in mind, scoped to whichever
	     analyst's scenario is currently shown. Hidden entirely when empty
	     rather than showing an empty-state - this is a quick-glance surface,
	     not a full section that needs to justify its own absence. -->
	{#if guidanceNotes.length}
		<div class="mt-3 pt-3 border-t border-border">
			<div class="text-[10px] font-semibold uppercase tracking-wide text-muted-fg mb-1.5">Guidance</div>
			<ul class="space-y-1">
				{#each guidanceNotes.slice(0, 2) as note (note.id)}
					<li class="text-xs text-fg flex gap-1.5">
						<span class="text-muted-fg shrink-0">{blockLabel(note.block_key)}:</span>
						<span class="truncate">{note.note}</span>
					</li>
				{/each}
			</ul>
			{#if guidanceNotes.length > 2}
				<div class="text-[10px] text-muted-fg mt-1">+{guidanceNotes.length - 2} more</div>
			{/if}
		</div>
	{/if}

	<!-- Review: the trackables (kill triggers) actively being monitored on
	     this scenario - a checklist, not the Review Queue's flagged
	     accept/reject inbox. Also hidden when empty. -->
	{#if trackables.length}
		<div class="mt-3 pt-3 border-t border-border">
			<div class="text-[10px] font-semibold uppercase tracking-wide text-muted-fg mb-1.5">Review</div>
			<ul class="space-y-1">
				{#each trackables.slice(0, 3) as t (t.id)}
					<li class="text-xs flex items-center gap-1.5">
						<span
							class="h-1.5 w-1.5 rounded-full shrink-0 {t.latest_fired ? 'bg-danger' : t.severity === 'kill' ? 'bg-warn' : 'bg-muted-fg'}"
						></span>
						<span class="truncate {t.latest_fired ? 'text-danger' : 'text-fg'}">{t.label}</span>
					</li>
				{/each}
			</ul>
			{#if trackables.length > 3}
				<div class="text-[10px] text-muted-fg mt-1">+{trackables.length - 3} more</div>
			{/if}
		</div>
	{/if}
</a>
