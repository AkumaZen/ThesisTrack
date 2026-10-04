<script lang="ts">
	import LineChart from './LineChart.svelte';
	import type { SectorReturn } from '$lib/sectorRotation';
	import {
		DEFAULT_SECTOR_CARD_METRICS,
		SECTOR_CARD_METRICS,
		type SectorCardMetric
	} from '$lib/prefs';

	// `row` is undefined while this basket's own fetch hasn't resolved yet — each SectorCard
	// instance owns exactly the slice of state that changes it, so one card resolving never
	// re-renders any other card (see +page.svelte, which fetches sectors one at a time and
	// writes each result into its own keyed slot).
	//
	// `href`/`linkText` are supplied by the calling page rather than hardcoded here — this same
	// component renders both the major-sector grid (links down to a subsector grid) and the
	// subsector grid (links down to individual companies), and shouldn't know which layer it's
	// being used at.
	let {
		label,
		tag,
		row,
		href,
		linkText,
		metrics = DEFAULT_SECTOR_CARD_METRICS
	}: {
		label: string;
		tag: string;
		row: SectorReturn | 'error' | undefined;
		href: string;
		linkText: string;
		/** Which figures to show, in order (the person's own choice; see lib/prefs.ts). */
		metrics?: SectorCardMetric[];
	} = $props();

	const shown = $derived(SECTOR_CARD_METRICS.filter((m) => metrics.includes(m.id)));

	function fmtPct(n: number | null) {
		return n == null ? '—' : `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`;
	}
	function toneClass(n: number | null) {
		if (n == null) return '';
		return n >= 0 ? 'signal-good' : 'signal-bad';
	}
</script>

<div class="sector-card">
	<div class="sector-card-head">
		<div class="sector-card-title">
			<span class="sector-card-label">{label}</span>
			<span class="sector-basket-tag">{tag}</span>
		</div>
		{#if row && row !== 'error'}
			<span
				class="wl-badge {row.signal === 'Rotating In'
					? 'wl-pos-badge'
					: row.signal === 'Rotating Out'
						? 'wl-neg-badge'
						: ''}">{row.signal}</span
			>
		{/if}
	</div>

	<div class="sector-card-chart">
		{#if row === 'error'}
			<div class="line-chart-empty">Couldn't load this basket — try again shortly.</div>
		{:else if row && row.series && row.series.length > 1}
			<LineChart points={row.series.map((p) => p.value)} height={70} />
		{:else if row}
			<div class="line-chart-empty">Not enough data to chart</div>
		{:else}
			<div class="sector-card-pending" aria-hidden="true"></div>
		{/if}
	</div>

	{#if row && row !== 'error'}
		<div class="sector-card-stats">
			{#each shown as m (m.id)}
				<div class="sector-stat" title={m.help}>
					<span class="sector-stat-label">{m.label}</span>
					<span class="sector-stat-value {toneClass(row[m.field])}">{fmtPct(row[m.field])}</span>
				</div>
			{/each}
		</div>
	{/if}

	<!-- Always shown, so a sector can be opened before (or without) its own figures loading.
		href is built by the caller via resolve() (see +page.svelte at each layer); the rule can't
		see across the prop boundary. -->
	<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
	<a class="sector-card-link" {href}>
		{linkText}
	</a>
</div>
