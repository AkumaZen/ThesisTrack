<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import CompanyPicker from '$lib/components/CompanyPicker.svelte';
	import { chartLines, PERIODS, returnRows, type Period } from '$lib/valuation/returns';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const period = $derived(data.period);
	const benchmark = $derived(data.indexKeys[0] ?? null);
	const rows = $derived(returnRows(data.items, benchmark));
	const chart = $derived(chartLines(data.items, period));
	const full = $derived(data.symbols.length >= data.maxStocks);

	function go(next: { s?: string[]; i?: string[]; p?: Period }) {
		const u = new URL(page.url);
		u.searchParams.set('s', (next.s ?? data.symbols).join(','));
		u.searchParams.set('i', (next.i ?? data.indexKeys).join(','));
		u.searchParams.set('p', next.p ?? data.period);
		// eslint-disable-next-line svelte/no-navigation-without-resolve
		goto(u, { keepFocus: true, noScroll: true });
	}
	const addStock = (symbol: string) => {
		const s = symbol.toUpperCase();
		if (!data.symbols.includes(s) && data.symbols.length < data.maxStocks) go({ s: [...data.symbols, s] });
	};
	const removeStock = (s: string) => go({ s: data.symbols.filter((x) => x !== s) });
	const toggleIndex = (key: string) =>
		go({ i: data.indexKeys.includes(key) ? data.indexKeys.filter((k) => k !== key) : [...data.indexKeys, key] });

	// Chart geometry: x by calendar time across the shared window, y by the rebased value.
	const W = 100;
	const H = 60;
	const COLORS = ['#2563eb', '#dc2626', '#15803d', '#a16207', '#7c3aed', '#0891b2', '#db2777', '#4d7c0f'];
	const view = $derived.by(() => {
		const all = chart.lines.flatMap((l) => l.points);
		if (all.length === 0) return null;
		const t0 = Math.min(...all.map((p) => Date.parse(p.date)));
		const t1 = Math.max(...all.map((p) => Date.parse(p.date)));
		const lo = Math.min(100, ...all.map((p) => p.close));
		const hi = Math.max(100, ...all.map((p) => p.close));
		const pad = (hi - lo) * 0.06 || 1;
		const x = (d: string) => (t1 === t0 ? 0 : ((Date.parse(d) - t0) / (t1 - t0)) * W);
		const y = (v: number) => H - ((v - (lo - pad)) / (hi - lo + 2 * pad)) * H;
		return { x, y, base: y(100) };
	});
	const pathOf = (points: { date: string; close: number }[]) =>
		view ? points.map((p) => `${view.x(p.date).toFixed(2)},${view.y(p.close).toFixed(2)}`).join(' ') : '';
	const color = (i: number, kind: string) => (kind === 'index' ? '#0a0a0a' : COLORS[i % COLORS.length]);

	const fmt = (n: number | null) => (n == null ? '-' : `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`);
	const tone = (n: number | null) => (n == null || n === 0 ? '' : n > 0 ? 'res-up' : 'res-down');
	const lastGain = (points: { close: number }[]) => points[points.length - 1].close - 100;
</script>

<svelte:head>
	<title>Returns benchmark · ThesisTrack</title>
</svelte:head>

<div class="band">
	<div class="band-inner">
		<h1>Returns benchmark</h1>
		<div class="sub">Stocks and indices rebased to 100, so the lines show who gained more.</div>
		<details class="calm-disclosure no-print">
			<summary>How this works</summary>
			<p>
				Built from stored daily prices (up to 1Y) and stored weekly prices (3Y). Excess is the return
				minus the first index selected. A blank 3Y means the weekly history is not stored yet for that
				item (an editor loads it with "Load 5-year highs" on the breakout scanner), or it did not trade
				three years ago.
			</p>
		</details>
	</div>
</div>

<div class="wrap wrap-wide an-page">
	<div class="scan-toolbar no-print">
		<div class="ret-picker">
			<label for="ret-add" class="sr-only">Add a stock</label>
			<CompanyPicker
				id="ret-add"
				label="Add a stock"
				placeholder="Add a stock by name or ticker"
				disabled={full}
				onPick={(h) => addStock(h.symbol)}
			/>
		</div>
		<div class="preset-chips" role="group" aria-label="Period">
			{#each PERIODS as p (p)}
				<button
					type="button"
					class="tag"
					class:tag-on={period === p}
					aria-pressed={period === p}
					onclick={() => go({ p })}
					data-testid="ret-period">{p}</button
				>
			{/each}
		</div>
	</div>
	<div class="preset-chips ret-indices no-print" role="group" aria-label="Indices">
		<span class="preset-chips-label">Indices</span>
		{#each data.indices as idx (idx.key)}
			<button
				type="button"
				class="tag"
				class:tag-on={data.indexKeys.includes(idx.key)}
				aria-pressed={data.indexKeys.includes(idx.key)}
				onclick={() => toggleIndex(idx.key)}>{idx.label}</button
			>
		{/each}
	</div>

	{#if data.items.length === 0}
		<p class="scan-note" data-testid="ret-empty">Add a stock or pick an index to compare.</p>
	{:else}
		<figure class="an-figure" data-testid="ret-chart">
			{#if view}
				<svg
					viewBox="0 0 {W} {H}"
					preserveAspectRatio="none"
					role="img"
					class="an-chart"
					aria-label="Rebased returns over {period}: {chart.lines.map((l) => `${l.label} ${fmt(lastGain(l.points))}`).join(', ')}"
				>
					<line x1="0" x2={W} y1={view.base} y2={view.base} class="an-grid" />
					{#each chart.lines as l, n (l.key)}
						<polyline
							points={pathOf(l.points)}
							class="an-line"
							style="stroke:{color(n, l.kind)}"
							stroke-dasharray={l.kind === 'index' ? '5 3' : undefined}
						/>
					{/each}
				</svg>
				<ul class="ret-legend">
					{#each chart.lines as l, n (l.key)}
						<li>
							<span
								class="an-key"
								style="border-top-color:{color(n, l.kind)};border-top-style:{l.kind === 'index' ? 'dashed' : 'solid'}"
							></span>
							{l.label}
							<strong class={tone(lastGain(l.points))}>{fmt(lastGain(l.points))}</strong>
						</li>
					{/each}
				</ul>
				<p class="hint">Dashed lines are indices. Level 100 is the start of the period ({chart.start}).</p>
			{:else}
				<p class="scan-note" data-testid="ret-chart-empty">
					No selected item has stored prices covering {period}.{period === '3Y'
						? ' 3Y needs the weekly history loaded with "Load 5-year highs" on the breakout scanner.'
						: ''}
				</p>
			{/if}
			{#if chart.skipped.length && view}
				<p class="hint">Not enough history for {period}: {chart.skipped.join(', ')}.</p>
			{/if}
		</figure>

		<div class="table-scroll">
			<table class="res-table" data-testid="ret-table">
				<thead>
					<tr>
						<th class="text">Name</th>
						{#each PERIODS as p (p)}<th>{p}</th>{/each}
						<th title="Return minus the first selected index, over the chosen period">Excess {period}</th>
						<th class="no-print"><span class="sr-only">Remove</span></th>
					</tr>
				</thead>
				<tbody>
					{#each rows as r (r.key)}
						<tr>
							<td class="text res-name"
								>{r.label}{#if r.kind === 'index'}
									<span class="scan-sub">index</span>{/if}</td
							>
							{#each PERIODS as p (p)}<td class="num {tone(r.returns[p])}">{fmt(r.returns[p])}</td>{/each}
							<td class="num {tone(r.excess?.[period] ?? null)}"
								>{r.key === benchmark ? 'benchmark' : fmt(r.excess?.[period] ?? null)}</td
							>
							<td class="no-print">
								{#if r.kind === 'stock'}
									<button type="button" class="wl-strip-btn" aria-label="Remove {r.label}" onclick={() => removeStock(r.key)}
										>Remove</button
									>
								{/if}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</div>
