<script lang="ts">
	// Top of the entry price card on the thesis page: the stale-review nudge and the price target
	// tracker. Everything arrives precomputed from the company API (stored prices only).
	import { formatReturn } from '$lib/entryPrice.js';
	import type { PriceTargetData, StaleData } from '../../routes/company/[id]/+page';

	let {
		priceTarget,
		stale,
		entryPrice,
		currentPrice
	}: {
		priceTarget: PriceTargetData | undefined;
		stale: StaleData | undefined;
		entryPrice: number | null | undefined;
		currentPrice: number | null | undefined;
	} = $props();

	const money = (n: number) => `\u20B9${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
	// Sign always spelled out so colour is never the only cue.
	const signed = (n: number) => formatReturn(n);

	let pt = $derived(priceTarget && 'target' in priceTarget ? priceTarget : null);
	let barNow = $derived(pt?.bar_pct != null ? Math.round(pt.bar_pct) : 0);
</script>

{#if stale?.stale && stale.reasons.length}
	<div class="nudge mb-3 border-2 border-border bg-warn/10 p-3 text-sm" role="status" data-testid="stale-nudge">
		<strong class="uppercase tracking-wide text-xs">Review due</strong>
		<ul class="mt-1 list-disc pl-5">
			{#each stale.reasons as reason (reason)}
				<li>{reason}</li>
			{/each}
		</ul>
	</div>
{/if}

<section class="mb-3 pb-3 border-b border-border" aria-label="Price target" data-testid="price-target">
	<h3 class="text-xs font-semibold uppercase tracking-wide text-muted-fg mb-2">Price target (base case, FY+2E)</h3>

	{#if !priceTarget || priceTarget.state === 'no_valuation'}
		<p class="text-sm" data-testid="target-none">
			<strong>No base-case valuation yet.</strong>
			{#if priceTarget?.symbol}
				<a class="underline ml-1" href={`/valuation/company/${encodeURIComponent(priceTarget.symbol)}`}>Open the valuation for {priceTarget.symbol}</a>
			{/if}
		</p>
	{:else if priceTarget.state === 'no_target'}
		<p class="text-sm" data-testid="target-unavailable">
			<strong>Base-case target unavailable.</strong>
			{priceTarget.reason === 'no_company_data'
				? 'The company data behind the valuation is not loaded yet.'
				: 'The saved valuation does not give a positive FY+2E price.'}
			<a class="underline ml-1" href={`/valuation/company/${encodeURIComponent(priceTarget.symbol)}`}>Open the valuation</a>
		</p>
	{:else if pt}
		<dl class="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-2 text-sm">
			<div>
				<dt class="text-xs text-muted-fg">Entry price</dt>
				<dd class="font-semibold" data-testid="pt-entry">{entryPrice != null ? money(entryPrice) : 'Not recorded'}</dd>
			</div>
			<div>
				<dt class="text-xs text-muted-fg">Current price</dt>
				<dd class="font-semibold" data-testid="pt-current">{currentPrice != null ? money(currentPrice) : 'No stored price yet'}</dd>
			</div>
			<div>
				<dt class="text-xs text-muted-fg">Target</dt>
				<dd class="font-semibold" data-testid="pt-target">{money(pt.target)}</dd>
			</div>
			<div>
				<dt class="text-xs text-muted-fg">{pt.state === 'reached' ? 'Beyond target' : 'Upside to target'}</dt>
				<dd class="font-semibold" data-testid="pt-upside">
					{#if pt.upside_pct == null}
						Not available
					{:else if pt.state === 'reached'}
						{signed(Math.abs(pt.upside_pct))}
					{:else}
						{signed(pt.upside_pct)}
					{/if}
				</dd>
			</div>
		</dl>

		<div class="mt-3" data-testid="pt-status">
			{#if pt.state === 'no_current'}
				<p class="text-sm">No stored current price yet, so progress to target can't be shown.</p>
			{:else if pt.state === 'reached'}
				<p class="text-sm"><strong>Target reached.</strong> The price is at or above the base-case target; consider whether it is time to re-underwrite.</p>
			{:else if pt.state === 'no_entry'}
				<p class="text-sm">No entry price recorded, so progress from entry can't be shown.</p>
			{:else if pt.state === 'target_below_entry'}
				<p class="text-sm"><strong>Target is at or below the entry price</strong>, so there is no progress to draw. The valuation may need a refresh.</p>
			{:else}
				{#if pt.state === 'below_entry'}
					<p class="text-sm mb-1"><strong>Below entry price.</strong> Progress is negative: {signed(pt.progress_pct ?? 0)} of the way from entry to target.</p>
				{:else}
					<p class="text-sm mb-1"><strong>{signed(pt.progress_pct ?? 0).replace('+', '')}</strong> of the way from entry to target.</p>
				{/if}
				<div
					class="track h-3 border-2 border-border bg-surface-3"
					role="progressbar"
					aria-label="Progress from entry price to target"
					aria-valuemin="0"
					aria-valuemax="100"
					aria-valuenow={barNow}
					aria-valuetext={`${signed(pt.progress_pct ?? 0)} of the way from entry to target`}
				>
					<div class="h-full bg-accent" style="width: {pt.bar_pct ?? 0}%"></div>
				</div>
				<div class="mt-1 flex justify-between text-xs text-muted-fg">
					<span>Entry</span><span>Target</span>
				</div>
			{/if}
			{#if pt.required_annual_pct != null}
				<p class="mt-2 text-xs text-muted-fg" data-testid="pt-required">
					Needs about {signed(pt.required_annual_pct)} a year from today to reach the target by FY+2E (2 years).
				</p>
			{/if}
			<p class="mt-1 text-xs text-muted-fg">
				From the saved valuation for {pt.symbol} (<a class="underline" href={`/valuation/company/${encodeURIComponent(pt.symbol)}`}>open</a>).
			</p>
		</div>
	{/if}
</section>
