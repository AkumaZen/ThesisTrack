<script lang="ts">
	import LineChart from './LineChart.svelte';
	import StrengthWhy from './StrengthWhy.svelte';
	import type { StrengthEvaluation } from '$lib/valuation/strength';
	import { rotationBadge, ROTATION_TONE_CLASS, type SectorReturn } from '$lib/valuation/sectorRotation';
	import { windowWithAverage } from '$lib/valuation/movingAverage';
	import { formatAsOf } from '$lib/valuation/priceAge';
	import { whenVisible } from '$lib/valuation/whenVisible';
	import {
		DEFAULT_SECTOR_CARD_METRICS,
		SECTOR_CARD_METRICS,
		type SectorCardMetric
	} from '$lib/valuation/prefs';

	// A card starts empty: `row` is undefined until the card scrolls into view, 'loading' while
	// that one request runs, then the stored figures (see +page.svelte). Each card owns exactly its
	// own slice of state, so one card loading never re-renders another.
	//
	// `href`/`linkText` are supplied by the calling page rather than hardcoded here - this same
	// component renders both the major-sector grid (links down to a subsector grid) and the
	// subsector grid (links down to individual companies), and shouldn't know which layer it's
	// being used at.
	let {
		label,
		tag,
		row,
		href,
		linkText,
		metrics = DEFAULT_SECTOR_CARD_METRICS,
		evaluation,
		onLoad,
		onRefresh,
		refreshing = null
	}: {
		label: string;
		tag: string;
		row: SectorReturn | 'error' | 'loading' | undefined;
		href: string;
		linkText: string;
		/** Which figures to show, in order (the person's own choice; see lib/prefs.ts). */
		metrics?: SectorCardMetric[];
		/** Strength & Volume result for this card while a filter is active. */
		evaluation?: StrengthEvaluation;
		/** Loads this card's stored figures and chart. */
		onLoad: () => void;
		/** Fetches fresh prices for the companies behind this card, then reloads it. */
		onRefresh: () => void;
		/** Progress text while a refresh runs ("Refreshing 12/40"), otherwise null. */
		refreshing?: string | null;
	} = $props();

	const shown = $derived(SECTOR_CARD_METRICS.filter((m) => metrics.includes(m.id)));

	// One year of sessions on the chart; the 200-day average is worked out over the whole history.
	const chart = $derived(
		row && row !== 'error' && row !== 'loading' && row.series && row.series.length > 1
			? windowWithAverage(
					row.series.map((p) => p.value),
					253,
					200
				)
			: null
	);

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
		{#if row && row !== 'error' && row !== 'loading'}
			{@const badge = rotationBadge(row)}
			<span class="wl-badge {ROTATION_TONE_CLASS[badge.tone]}" title={badge.title}>{badge.text}</span>
		{/if}
	</div>

	<div class="sector-card-chart">
		{#if row === undefined}
			<div class="sector-card-pending" role="status" aria-label="Loading {label}" use:whenVisible={onLoad}></div>
		{:else if row === 'loading'}
			<div class="sector-card-pending" role="status" aria-label="Loading {label}"></div>
		{:else if row === 'error'}
			<div class="line-chart-empty">
				Couldn't load this one.
				<button type="button" class="sector-card-retry" onclick={onLoad}>Try again</button>
			</div>
		{:else if chart}
			<LineChart points={chart.points} sma200={chart.average} height={70} />
		{:else}
			<div class="line-chart-empty">No stored prices yet. Press Refresh to fetch them.</div>
		{/if}
	</div>

	{#if row && row !== 'error' && row !== 'loading'}
		<div class="sector-card-stats">
			{#each shown as m (m.id)}
				<div class="sector-stat" title={m.help}>
					<span class="sector-stat-label">{m.label}</span>
					<span class="sector-stat-value {toneClass(row[m.field])}">{fmtPct(row[m.field])}</span>
				</div>
			{/each}
		</div>
	{/if}

	{#if row && row !== 'error' && row !== 'loading'}
		<div class="sector-card-foot">
			<span class="sector-card-asof">
				{#if refreshing}
					{refreshing}
				{:else if row.asOf}
					Prices as of {formatAsOf(row.asOf)}{row.missing ? ` · ${row.missing} without prices` : ''}
				{:else}
					No stored prices
				{/if}
			</span>
			<button type="button" class="sector-card-refresh" disabled={refreshing != null} onclick={onRefresh}
				>Refresh</button
			>
		</div>
	{/if}

	<StrengthWhy {evaluation} />

	<!-- Always shown, so a sector can be opened before (or without) its own figures loading.
		href is built by the caller via resolve() (see +page.svelte at each layer); the rule can't
		see across the prop boundary. -->
	<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
	<a class="sector-card-link" {href}>
		{linkText}
	</a>
</div>
