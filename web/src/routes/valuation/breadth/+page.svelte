<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { advanceDeclineRatio, breadthRead, headlineBreadth, pct } from '$lib/valuation/breadth';
	import DmaBreadthChart from '$lib/valuation/components/DmaBreadthChart.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const isAdmin = $derived(data.user?.role === 'admin');
	const canRefresh = $derived(Boolean(data.user?.role && data.user.role !== 'read_only'));
	const headline = $derived(headlineBreadth(data.rows));
	// The headline tiles only ever show a session that nearly the whole universe has reported.
	const latest = $derived(headline.row);
	const fmtDay = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
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

	// Admin: loads the daily closes of every NSE equity in resumable slices (each call stays inside the
	// function limit and saves its progress), repeating until the server says it is finished.
	let backfilling = $state(false);
	let backfillMessage = $state<string | null>(null);
	async function backfill(options: { retryFailed?: boolean; rebuild?: boolean } = {}) {
		backfilling = true;
		backfillMessage = null;
		try {
			let slice = 0;
			for (;;) {
				slice++;
				backfillMessage = `Loading history, slice ${slice}...`;
				const res = await fetch('/api/valuation/breadth/backfill', {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify(slice === 1 ? options : { retryFailed: options.retryFailed })
				});
				const body = await res.json().catch(() => null);
				if (!res.ok) throw new Error(body?.message ?? `HTTP ${res.status}`);
				backfillMessage = `Slice ${slice}: ${body.remaining} of ${body.universe} stocks left (${body.failed} failed this slice).`;
				if (body.aborted) throw new Error(body.aborted);
				if (body.finished) {
					backfillMessage = `History loaded for ${body.universe} stocks; ${body.aggregate?.rows ?? 0} days computed.`;
					break;
				}
				if (body.processed === 0) throw new Error('No progress; try again later.');
			}
			await invalidateAll();
		} catch (e) {
			backfillMessage = e instanceof Error ? e.message : 'Could not load the history.';
		} finally {
			backfilling = false;
		}
	}
	const st = $derived(data.market.status);

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
		<div class="sub">Share of stocks above their moving averages, plus advances, declines and 52-week extremes.</div>
		<details class="calm-disclosure no-print">
			<summary>How this works</summary>
			<p>
				The whole-market chart shows the share of all NSE stocks below their 50 day average; the cards
				cover the scanner stocks. Everything is computed from stored daily prices; no live data.
			</p>
			<p>
				Universe: every company listed on NSE or BSE with a six-month average market cap above Rs 500 Cr (AMFI list, one row per company, no upper limit; {st.done} with stored closes{st.empty ? `, ${st.empty} with no prices` : ''}{st.failed ? `, ${st.failed} failed` : ''}{st.stale ? `, ${st.stale} to refetch` : ''}). Prices come from NSE, or BSE for BSE-only names. Funds, ETFs, debt and indices are not in the list. The list is today's: past days use today's members, so companies that have since delisted or shrunk below Rs 500 Cr are missing, and companies that have since grown past it count for days before they qualified.
			</p>
		</details>
	</div>
</div>

<div class="wrap wrap-wide an-page">
	{#if data.market.points.length > 0}
		<DmaBreadthChart points={data.market.points} computedAt={data.market.status.computedAt} />
	{:else}
		<p class="scan-note" data-testid="dma-empty">
			The whole-market chart has no data yet.{isAdmin ? ' Load the history below.' : ' An admin has to load the price history first.'}
		</p>
	{/if}
	{#if data.rows.length === 0}
		<p class="scan-note" data-testid="breadth-empty">
			No breadth stored yet.{canRefresh ? ' Press "Refresh breadth" to compute it from the stored prices.' : ' An editor can compute it.'}
		</p>
	{:else}
		{#if !latest}
			<p class="scan-note" data-testid="breadth-incomplete">
				No stored session has reported for at least 90% of the {headline.typical.toLocaleString('en-IN')} stocks yet. Recompute breadth once prices have refreshed.
			</p>
		{:else}
			<p class="hint">Scanner universe, as of {latest.asOf}, {latest.total.toLocaleString('en-IN')} stocks measured. Overall read: <strong>{read}</strong>.</p>
			{#if headline.partial}
				<p class="hint" data-testid="breadth-partial-note">
					{fmtDay(headline.partial.asOf)} is still loading: {headline.partial.total.toLocaleString('en-IN')} of {headline.typical.toLocaleString('en-IN')} stocks have reported. Showing {fmtDay(latest.asOf)}.
				</p>
			{/if}
		<ul class="an-cards" data-testid="breadth-cards">
			<li class="an-card">
				<span class="an-label">Advance / decline</span>
				<strong class="an-value">{latest.advances} / {latest.declines}</strong>
				<span class="an-sub">of {latest.total.toLocaleString('en-IN')} stocks &middot; {latest.unchanged} unchanged{advanceDeclineRatio(latest) != null ? ` · ratio ${f(advanceDeclineRatio(latest), 2)}` : ''}</span>
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
		{/if}

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
					<span class="an-key an-key-b"></span> % above 200 DMA (scanner universe, last {data.rows.length} sessions, scale 0 to 100%)
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
							<td class="text">{r.asOf}{#if headline.partialDates.has(r.asOf)}<span class="hint" style="margin-left: 0.75em" data-testid="breadth-partial-row">partial ({r.total.toLocaleString('en-IN')})</span>{/if}</td>
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

	{#if isAdmin || canRefresh}
		<details class="calm-disclosure calm-data no-print" open={busy || backfilling || Boolean(message || backfillMessage)}>
			<summary>Data</summary>
			<div class="calm-data-body">
				{#if isAdmin}
					<div class="an-actions no-print">
						<button type="button" class="wl-strip-btn" onclick={() => backfill()} disabled={backfilling} data-testid="breadth-backfill">
							{backfilling ? 'Loading...' : data.market.points.length === 0 ? 'Load market history' : 'Update market history'}
						</button>
						{#if st.failed > 0}
							<button type="button" class="wl-strip-btn" onclick={() => backfill({ retryFailed: true })} disabled={backfilling}>Retry failed</button>
						{/if}
						{#if backfillMessage}<span class="hint" role="status">{backfillMessage}</span>{/if}
					</div>
				{/if}
			
				{#if canRefresh}
					<div class="an-actions no-print">
						<button type="button" class="wl-strip-btn" onclick={refresh} disabled={busy} data-testid="breadth-refresh">
							{busy ? 'Computing...' : 'Refresh breadth'}
						</button>
						{#if message}<span class="hint" role="status">{message}</span>{/if}
					</div>
				{/if}
			</div>
		</details>
	{/if}
</div>
