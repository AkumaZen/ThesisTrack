<script lang="ts">
	import { resolve } from '$app/paths';
	import LineChart from './LineChart.svelte';
	import StrengthWhy from './StrengthWhy.svelte';
	import type { StrengthEvaluation } from '$lib/valuation/strength';
	import { sliceForTimeframe, computeConstituentGrowth, type Timeframe } from '$lib/valuation/sectorRotation';
	import { windowWithAverage } from '$lib/valuation/movingAverage';
	import { formatAsOf } from '$lib/valuation/priceAge';
	import { whenVisible } from '$lib/valuation/whenVisible';
	import { companyName } from '$lib/valuation/symbolNames';

	// A card starts empty: `closes` is undefined until the card scrolls into view, 'loading'
	// while that one request runs, null when there are no stored prices for the company. Each card
	// owns exactly its own slot of state (see +page.svelte).
	let {
		symbol,
		closes,
		fetchedAt = null,
		timeframe,
		evaluation,
		onLoad,
		onRefresh,
		refreshing = null
	}: {
		symbol: string;
		closes: number[] | null | 'error' | 'loading' | undefined;
		/** When the stored prices were last fetched (ms). */
		fetchedAt?: number | null;
		timeframe: Timeframe;
		/** Strength & Volume result for this company while a filter is active. */
		evaluation?: StrengthEvaluation;
		onLoad: () => void;
		/** Fetches fresh prices for this company, then reloads the card. */
		onRefresh: () => void;
		/** Progress text while a refresh runs, otherwise null. */
		refreshing?: string | null;
	} = $props();

	// Practitioner audience still wants the ticker, but the *name* is the card's primary label -
	// see symbolNames.ts for why this is a static lookup rather than a per-card fetch.
	let name = $derived(companyName(symbol));

	// The chosen stretch of sessions, with the 200-day average worked out over the whole history.
	const chart = $derived(
		Array.isArray(closes) && closes.length > 1
			? windowWithAverage(closes, sliceForTimeframe(closes, timeframe).length, 200)
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
			<span class="sector-card-label">{name}</span>
			<span class="sector-basket-tag">{symbol}</span>
		</div>
		<a
			class="sector-constituent-open"
			href={resolve('/valuation/company/[symbol]', { symbol })}
			title="Open {name}'s valuation page">Open valuation ↗</a
		>
	</div>

	<div class="sector-card-chart">
		{#if closes === undefined}
			<div class="sector-card-pending" role="status" aria-label="Loading {name}" use:whenVisible={onLoad}></div>
		{:else if closes === 'loading'}
			<div class="sector-card-pending" role="status" aria-label="Loading {name}"></div>
		{:else if closes === 'error'}
			<div class="line-chart-empty">
				Couldn't load {name}.
				<button type="button" class="sector-card-retry" onclick={onLoad}>Try again</button>
			</div>
		{:else if closes === null}
			<div class="line-chart-empty">
				No stored prices for {name} yet. Press Refresh to fetch them (not every company is listed
				on Angel One).
			</div>
		{:else if chart}
			<LineChart points={chart.points} sma200={chart.average} height={80} />
		{:else}
			<div class="line-chart-empty">Not enough data to chart</div>
		{/if}
	</div>

	{#if Array.isArray(closes)}
		{@const growth = computeConstituentGrowth(closes)}
		<div class="sector-card-stats">
			<div class="sector-stat">
				<span class="sector-stat-label">1W</span>
				<span class="sector-stat-value {toneClass(growth.return1w)}">{fmtPct(growth.return1w)}</span
				>
			</div>
			<div class="sector-stat">
				<span class="sector-stat-label">1M</span>
				<span class="sector-stat-value {toneClass(growth.return1m)}">{fmtPct(growth.return1m)}</span
				>
			</div>
			<div class="sector-stat">
				<span class="sector-stat-label">3M</span>
				<span class="sector-stat-value {toneClass(growth.return3m)}">{fmtPct(growth.return3m)}</span
				>
			</div>
			<div class="sector-stat">
				<span class="sector-stat-label">6M</span>
				<span class="sector-stat-value {toneClass(growth.return6m)}">{fmtPct(growth.return6m)}</span
				>
			</div>
			<div class="sector-stat">
				<span class="sector-stat-label">1Y</span>
				<span class="sector-stat-value {toneClass(growth.return1y)}">{fmtPct(growth.return1y)}</span
				>
			</div>
		</div>
	{/if}

	{#if closes !== undefined && closes !== 'loading' && closes !== 'error'}
		<div class="sector-card-foot">
			<span class="sector-card-asof">
				{#if refreshing}
					{refreshing}
				{:else if fetchedAt}
					Prices as of {formatAsOf(fetchedAt)}
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
</div>
