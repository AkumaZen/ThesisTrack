<script lang="ts">
	import { resolve } from '$app/paths';
	import LineChart from './LineChart.svelte';
	import { sliceForTimeframe, computeConstituentGrowth, type Timeframe } from '$lib/valuation/sectorRotation';
	import { companyName } from '$lib/valuation/symbolNames';

	// `closes` is undefined while this company's own fetch hasn't resolved yet — each card owns
	// exactly its own slot of state, so one company's data arriving never re-renders any other
	// card in the basket (see +page.svelte, which fetches companies one at a time).
	let {
		symbol,
		closes,
		timeframe
	}: {
		symbol: string;
		closes: number[] | null | 'error' | undefined;
		timeframe: Timeframe;
	} = $props();

	// Practitioner audience still wants the ticker, but the *name* is the card's primary label —
	// see symbolNames.ts for why this is a static lookup rather than a per-card fetch.
	let name = $derived(companyName(symbol));

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
		{#if closes === 'error'}
			<div class="line-chart-empty">Couldn't load {name} — try again shortly.</div>
		{:else if closes === null}
			<div class="line-chart-empty">{name} isn't listed on Angel One — no live price data.</div>
		{:else if closes && closes.length > 1}
			<LineChart points={sliceForTimeframe(closes, timeframe)} height={80} />
		{:else if closes}
			<div class="line-chart-empty">Not enough data to chart</div>
		{:else}
			<div class="sector-card-pending" aria-hidden="true"></div>
		{/if}
	</div>

	{#if closes && closes !== 'error'}
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
</div>
