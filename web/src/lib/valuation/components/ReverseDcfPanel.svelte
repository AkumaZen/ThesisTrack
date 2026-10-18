<script lang="ts">
	// Reverse DCF: given today's market cap, what yearly earnings growth does the price already assume?
	// Works on stored Screener numbers (no fetch); every assumption can be changed and the answer updates.
	import {
		DEFAULT_DISCOUNT_RATE,
		DEFAULT_TERMINAL_GROWTH,
		DEFAULT_YEARS,
		historicCagr,
		solveImpliedGrowth
	} from '$lib/valuation/reverseDcf';

	let {
		marketCap,
		baseEarnings,
		baseLabel,
		profitHistory
	}: {
		/** Rs crore. */
		marketCap: number | null;
		/** Latest financial year net profit, Rs crore. */
		baseEarnings: number | null;
		baseLabel: string | null;
		/** Annual net profit, oldest first, for comparing the implied growth with what the company has done. */
		profitHistory: (number | null)[];
	} = $props();

	let discountPct = $state(DEFAULT_DISCOUNT_RATE * 100);
	let terminalPct = $state(DEFAULT_TERMINAL_GROWTH * 100);
	let years = $state(DEFAULT_YEARS);
	// null = use the stored net profit; a number = the user's own base.
	let baseOverride = $state<number | null>(null);
	const base = $derived(baseOverride ?? baseEarnings ?? 0);

	const result = $derived(
		marketCap == null
			? ({ kind: 'invalid', reason: 'Market cap is not stored for this company.' } as const)
			: solveImpliedGrowth(marketCap, {
					baseEarnings: base,
					discountRate: discountPct / 100,
					terminalGrowth: terminalPct / 100,
					years: Math.round(years)
				})
	);
	const cagr3 = $derived(historicCagr(profitHistory, 3));
	const cagr5 = $derived(historicCagr(profitHistory, 5));
	const pct = (v: number | null) => (v == null ? 'n/a' : `${(v * 100).toFixed(1)}%`);
	const reading = $derived.by(() => {
		if (result.kind !== 'ok') return null;
		const ref = cagr3 ?? cagr5;
		if (ref == null) return null;
		const g = result.growth;
		if (g > ref + 0.03) return 'The price assumes faster growth than the company has recently delivered.';
		if (g < ref - 0.03) return 'The price assumes slower growth than the company has recently delivered.';
		return 'The price assumes about the growth the company has recently delivered.';
	});
</script>

<div class="stage-panel rdcf" data-testid="reverse-dcf">
	<div class="depth-head">
		<span class="exhibit-cap" style="margin:0">Reverse DCF: what growth is priced in?</span>
	</div>
	<div class="rdcf-grid">
		<label>
			<span>Discount rate %</span>
			<input class="sm-input" type="number" min="1" max="40" step="0.5" bind:value={discountPct} data-testid="rdcf-discount" />
		</label>
		<label>
			<span>Terminal growth %</span>
			<input class="sm-input" type="number" min="0" max="10" step="0.5" bind:value={terminalPct} data-testid="rdcf-terminal" />
		</label>
		<label>
			<span>Growth years</span>
			<input class="sm-input" type="number" min="1" max="30" step="1" bind:value={years} data-testid="rdcf-years" />
		</label>
		<label>
			<span>Base earnings, Rs cr{baseLabel ? ` (${baseLabel})` : ''}</span>
			<input
				class="sm-input"
				type="number"
				step="any"
				value={base}
				oninput={(e) => {
					const v = e.currentTarget.valueAsNumber;
					baseOverride = Number.isFinite(v) ? v : null;
				}}
				data-testid="rdcf-base"
			/>
		</label>
	</div>
	<div class="rdcf-out" aria-live="polite" data-testid="rdcf-result">
		{#if result.kind === 'ok'}
			<p>
				Market cap Rs {marketCap?.toLocaleString('en-IN', { maximumFractionDigits: 0 })} cr needs earnings to grow
				<strong>{pct(result.growth)}</strong> a year for {Math.round(years)} years, then {terminalPct}% for ever, at a {discountPct}% discount rate.
			</p>
			<p class="hint">
				Net profit CAGR: 3 years {pct(cagr3)}, 5 years {pct(cagr5)}.{reading ? ` ${reading}` : ''}
			</p>
		{:else if result.kind === 'above-range'}
			<p>The price is above what even 150% yearly growth justifies with these assumptions.</p>
		{:else if result.kind === 'below-range'}
			<p>The price is below what the earnings are worth even if they fell 50% a year: the market is pricing a collapse.</p>
		{:else}
			<p class="price-error">{result.reason}</p>
		{/if}
		<p class="hint">
			Base is net profit, a stand-in for owner earnings (free cash flow is not stored). Banks and lenders, and
			companies with losses, do not suit this model.
		</p>
	</div>
</div>
