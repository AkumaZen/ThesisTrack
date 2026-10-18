<script lang="ts">
	import { resolve } from '$app/paths';
	import { untrack } from 'svelte';
	import { GRID_PAGE, missingCloseChunks, sparkPoints, type GridItem } from '$lib/valuation/chartGrid';

	// A grid of mini price charts. Only the first page of tiles is drawn; "Show more" adds more, so a
	// long result list stays fast. Tiles without closes get them from the stored prices (one request
	// per 50 visible tiles, never Angel One).
	let { items, fetchCloses = false }: { items: GridItem[]; fetchCloses?: boolean } = $props();

	let visible = $state(GRID_PAGE);
	// Closes fetched for tiles that arrived without; an empty array means "none stored".
	let fetched = $state.raw<Record<string, number[]>>({});
	const inFlight = new Set<string>();

	// A different list (new filter or preset) starts again from the first page.
	let firstSymbol = '';
	$effect(() => {
		const key = `${items.length}:${items[0]?.symbol ?? ''}`;
		if (key === firstSymbol) return;
		firstSymbol = key;
		untrack(() => (visible = GRID_PAGE));
	});

	$effect(() => {
		if (!fetchCloses) return;
		const chunks = missingCloseChunks(items, visible, fetched)
			.map((c) => c.filter((s) => !inFlight.has(s)))
			.filter((c) => c.length > 0);
		for (const chunk of chunks) {
			chunk.forEach((s) => inFlight.add(s));
			void (async () => {
				const got: Record<string, number[]> = Object.fromEntries(chunk.map((s) => [s, []]));
				try {
					const res = await fetch(`/api/valuation/sparklines?symbols=${encodeURIComponent(chunk.join(','))}`);
					if (res.ok) Object.assign(got, ((await res.json()) as { series: Record<string, number[]> }).series);
				} catch {
					// tiles stay without a chart; the price and link still work
				}
				fetched = { ...fetched, ...got };
			})();
		}
	});

	const shown = $derived(items.slice(0, visible));
	const closesOf = (i: GridItem) => (i.closes && i.closes.length >= 2 ? i.closes : (fetched[i.symbol] ?? null));
	const fmtPrice = (n: number | null) =>
		n == null ? '-' : n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
	const fmtChange = (n: number | null) => (n == null ? '-' : `${n > 0 ? '+' : ''}${n.toFixed(2)}%`);
	const tone = (n: number | null) => (n == null ? '' : n >= 0 ? 'cg-up' : 'cg-down');
</script>

<ul class="chart-grid" data-testid="chart-grid">
	{#each shown as item (item.symbol)}
		{@const closes = closesOf(item)}
		{@const points = sparkPoints(closes)}
		<li class="cg-tile" data-testid="chart-tile">
			<a
				class="cg-link"
				href={resolve('/valuation/company/[symbol]', { symbol: item.symbol })}
				aria-label="{item.name}, {item.symbol}, last price {fmtPrice(item.price)}, change {fmtChange(item.changePct)}. Open company."
			>
				<span class="cg-head">
					<span class="cg-symbol">{item.symbol}</span>
					<span class="cg-change {tone(item.changePct)}">{fmtChange(item.changePct)}</span>
				</span>
				<span class="cg-name">{item.name}</span>
				{#if points && closes}
					<svg
						class="cg-chart {closes[closes.length - 1] >= closes[0] ? 'cg-up' : 'cg-down'}"
						viewBox="0 0 120 40"
						preserveAspectRatio="none"
						role="img"
						aria-label="Price trend over the last {closes.length} sessions"
					>
						<polyline {points} />
					</svg>
				{:else}
					<span class="cg-chart cg-empty">
						{fetchCloses && !(item.symbol in fetched) ? 'Loading chart' : 'No chart data'}
					</span>
				{/if}
				<span class="cg-price">{fmtPrice(item.price)}</span>
			</a>
		</li>
	{/each}
</ul>

{#if items.length > shown.length}
	<p class="scan-more no-print">
		<button type="button" class="wl-strip-btn" data-testid="grid-more" onclick={() => (visible += GRID_PAGE)}
			>Show {Math.min(GRID_PAGE, items.length - shown.length)} more</button
		>
		<span class="hint">{shown.length} of {items.length} shown</span>
	</p>
{/if}
