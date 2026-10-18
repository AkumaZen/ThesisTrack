<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { advanceDeclineRatio, breadthRead, pct } from '$lib/valuation/breadth';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const canRefresh = $derived(Boolean(data.user?.role && data.user.role !== 'read_only'));
	const latest = $derived(data.rows.length ? data.rows[data.rows.length - 1] : null);
	const history = $derived([...data.rows].reverse());
	const read = $derived(latest ? breadthRead(latest) : 'no data');

	let busy = $state(false);
	let message = $state<string | null>(null);
	async function refresh() {
		busy = true;
		message = null;
		try {
			const res = await fetch('/api/valuation/breadth/refresh', { method: 'POST' });
			const body = await res.json().catch(() => null);
			if (!res.ok) throw new Error(body?.message ?? `HTTP ${res.status}`);
			message = `Updated ${body.rows} sessions from ${body.symbols} stocks.`;
			await invalidateAll();
		} catch (e) {
			message = e instanceof Error ? e.message : 'Could not refresh breadth.';
		} finally {
			busy = false;
		}
	}

	const f = (n: number | null, d = 0) => (n == null ? '-' : n.toFixed(d));

	// Chart: share of stocks above the 50 and 200 day averages, one point per stored session.
	const W = 100;
	const H = 60;
	const line = (pick: (r: (typeof data.rows)[number]) => number | null) => {
		const pts = data.rows
			.map((r, i) => {
				const v = pick(r);
				return v == null || data.rows.length < 2 ? null : `${((i / (data.rows.length - 1)) * W).toFixed(2)},${(H - (v / 100) * H).toFixed(2)}`;
			})
			.filter((p): p is string => p != null);
		return pts.length >= 2 ? pts.join(' ') : '';
	};
	const line50 = $derived(line((r) => pct(r.aboveDma50, r.withDma50)));
	const line200 = $derived(line((r) => pct(r.aboveDma200, r.withDma200)));
	const COLUMNS = ['Date', 'Advances', 'Declines', 'A/D', 'Above 50 DMA', 'Above 200 DMA', '52w highs', '52w lows'];
</script>

<svelte:head>
	<title>Market breadth · ThesisTrack</title>
</svelte:head>

<div class="band">
	<div class="band-inner">
		<h1>Market breadth</h1>
		<div class="sub">
			How many scanner stocks advance or decline, sit above their 50 and 200 day averages, and make 52-week
			highs or lows. Computed from stored daily prices; no live data. The last {data.rows.length || 30} sessions are
			kept.
		</div>
	</div>
</div>

<div class="wrap wrap-wide an-page">
	{#if canRefresh}
		<div class="an-actions no-print">
			<button type="button" class="wl-strip-btn" onclick={refresh} disabled={busy} data-testid="breadth-refresh">
				{busy ? 'Computing...' : 'Refresh breadth'}
			</button>
			{#if message}<span class="hint" role="status">{message}</span>{/if}
		</div>
	{/if}

	{#if !latest}
		<p class="scan-note" data-testid="breadth-empty">
			No breadth stored yet.{canRefresh ? ' Press "Refresh breadth" to compute it from the stored prices.' : ' An editor can compute it.'}
		</p>
	{:else}
		<p class="hint">As of {latest.asOf}, {latest.total} stocks measured. Overall read: <strong>{read}</strong>.</p>
		<ul class="an-cards" data-testid="breadth-cards">
			<li class="an-card">
				<span class="an-label">Advance / decline</span>
				<strong class="an-value">{latest.advances} / {latest.declines}</strong>
				<span class="an-sub">{latest.unchanged} unchanged{advanceDeclineRatio(latest) != null ? ` · ratio ${f(advanceDeclineRatio(latest), 2)}` : ''}</span>
			</li>
			<li class="an-card">
				<span class="an-label">Above 50 DMA</span>
				<strong class="an-value">{f(pct(latest.aboveDma50, latest.withDma50), 1)}%</strong>
				<span class="an-sub">{latest.aboveDma50} of {latest.withDma50}</span>
			</li>
			<li class="an-card">
				<span class="an-label">Above 200 DMA</span>
				<strong class="an-value">{f(pct(latest.aboveDma200, latest.withDma200), 1)}%</strong>
				<span class="an-sub">{latest.aboveDma200} of {latest.withDma200}</span>
			</li>
			<li class="an-card">
				<span class="an-label">52-week highs / lows</span>
				<strong class="an-value">{latest.highs52w} / {latest.lows52w}</strong>
				<span class="an-sub">stocks at the extreme today</span>
			</li>
		</ul>

		{#if line50 || line200}
			<figure class="an-figure">
				<svg
					viewBox="0 0 {W} {H}"
					preserveAspectRatio="none"
					role="img"
					aria-label="Share of stocks above their 50 and 200 day averages over the last {data.rows.length} sessions"
					class="an-chart"
				>
					<line x1="0" x2={W} y1={H / 2} y2={H / 2} class="an-grid" />
					{#if line50}<polyline points={line50} class="an-line an-line-a" />{/if}
					{#if line200}<polyline points={line200} class="an-line an-line-b" />{/if}
				</svg>
				<figcaption class="hint">
					<span class="an-key an-key-a"></span> % above 50 DMA
					<span class="an-key an-key-b"></span> % above 200 DMA (scale 0 to 100%)
				</figcaption>
			</figure>
		{/if}

		<div class="table-scroll">
			<table class="res-table" data-testid="breadth-table">
				<thead>
					<tr>
						{#each COLUMNS as c, i (c)}<th class={i === 0 ? 'text' : ''}>{c}</th>{/each}
					</tr>
				</thead>
				<tbody>
					{#each history as r (r.asOf)}
						<tr>
							<td class="text">{r.asOf}</td>
							<td class="num res-up">{r.advances}</td>
							<td class="num res-down">{r.declines}</td>
							<td class="num">{f(advanceDeclineRatio(r), 2)}</td>
							<td class="num">{f(pct(r.aboveDma50, r.withDma50), 1)}%</td>
							<td class="num">{f(pct(r.aboveDma200, r.withDma200), 1)}%</td>
							<td class="num">{r.highs52w}</td>
							<td class="num">{r.lows52w}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</div>
