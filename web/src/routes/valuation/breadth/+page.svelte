<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { advanceDeclineRatio, breadthRead, headlineBreadth, pct } from '$lib/valuation/breadth';
	import { formatIst } from '$lib/valuation/livePass';
	import DmaBreadthChart from '$lib/valuation/components/DmaBreadthChart.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const isAdmin = $derived(data.user?.role === 'admin');
	const canRefresh = $derived(Boolean(data.user?.role && data.user.role !== 'read_only'));
	const headline = $derived(headlineBreadth(data.rows, data.liveDay));
	// The headline tiles only ever show a session that nearly the whole universe has reported.
	const latest = $derived(headline.row);
	const fmtLong = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
	const fmtDay = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
	const history = $derived([...data.rows].reverse());
	const read = $derived(latest ? breadthRead(latest) : 'no data');

	// ---- Control strip: live refresh (editors and admins) and the history jobs (admins) ----
	const BATCH = 50;
	let liveBusy = $state(false);
	let liveMessage = $state<string | null>(null);
	let liveFailed = $state(false);
	// One job at a time: the quote batches and the history slices share the Angel One limits.
	let backfilling = $state(false);
	let backfillMessage = $state<string | null>(null);
	let confirmRebuild = $state(false);
	const working = $derived(liveBusy || backfilling);

	async function post(url: string, body: unknown) {
		const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
		const json = await res.json().catch(() => null);
		if (!res.ok) throw new Error(json?.message ?? `HTTP ${res.status}`);
		return json;
	}

	// Fetches live quotes for the whole breadth list now (batches of 50, one quote request each) and
	// recomputes the cards/table and the whole-market chart. Same work as the background pass.
	async function refreshLive() {
		liveBusy = true;
		liveFailed = false;
		liveMessage = 'Preparing the stock list...';
		try {
			const { symbols } = (await post('/api/valuation/breadth/live', { step: 'plan' })) as { symbols: string[] };
			const total = Math.ceil(symbols.length / BATCH);
			let failedBatches = 0;
			let streak = 0;
			for (let i = 0; i < total; i++) {
				liveMessage = `Batch ${i + 1} of ${total}`;
				try {
					await post('/api/valuation/breadth/live', { step: 'batch', symbols: symbols.slice(i * BATCH, (i + 1) * BATCH) });
					streak = 0;
				} catch (e) {
					failedBatches++;
					if (++streak >= 3) throw e;
				}
			}
			liveMessage = 'Recomputing the cards and table...';
			await post('/api/valuation/breadth/live', { step: 'cards' });
			liveMessage = 'Recomputing the whole-market chart...';
			await post('/api/valuation/breadth/live', { step: 'market' });
			await invalidateAll();
			liveMessage = `Updated from live quotes for ${symbols.length.toLocaleString('en-IN')} stocks${failedBatches ? `; ${failedBatches} of ${total} batches failed, press Refresh breadth again` : ''}.`;
			liveFailed = failedBatches > 0;
		} catch (e) {
			liveFailed = true;
			liveMessage = `Stopped: ${e instanceof Error ? e.message : 'could not refresh breadth.'}`;
		} finally {
			liveBusy = false;
		}
	}

	// Admin: loads the daily closes of every NSE equity in resumable slices (each call stays inside the
	// function limit and saves its progress), repeating until the server says it is finished.
	async function backfill(options: { retryFailed?: boolean; rebuild?: boolean } = {}) {
		backfilling = true;
		confirmRebuild = false;
		backfillMessage = null;
		try {
			let slice = 0;
			for (;;) {
				slice++;
				backfillMessage = `Loading history, slice ${slice}...`;
				const body = await post('/api/valuation/breadth/backfill', slice === 1 ? options : { retryFailed: options.retryFailed });
				backfillMessage = `Slice ${slice}: ${Number(body.remaining).toLocaleString('en-IN')} of ${Number(body.universe).toLocaleString('en-IN')} stocks left (${body.failed} failed this slice).`;
				if (body.aborted) throw new Error(body.aborted);
				if (body.finished) {
					backfillMessage = `History loaded for ${Number(body.universe).toLocaleString('en-IN')} stocks; ${body.aggregate?.rows ?? 0} days computed.`;
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

	const stamp = $derived(data.computedAt ? formatIst(data.computedAt) : null);
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
	<section class="live-strip no-print" aria-label="Refresh breadth" data-testid="breadth-controls">
		<div class="live-row">
			{#if canRefresh}
				<button type="button" class="wl-strip-btn btn-primary" onclick={refreshLive} disabled={working} data-testid="breadth-refresh">
					{liveBusy ? 'Refreshing...' : 'Refresh breadth'}
				</button>
			{/if}
			<span class="hint" data-testid="breadth-updated">{stamp ? `Last updated ${stamp} IST` : 'Breadth has not been computed yet'}</span>
			{#if data.liveDay}<span class="live-tag" data-testid="breadth-live-badge">Live, provisional</span>{/if}
		</div>
		{#if isAdmin}
			<div class="live-row">
				<button type="button" class="wl-strip-btn" onclick={() => backfill()} disabled={working} data-testid="breadth-backfill">
					{backfilling ? 'Loading...' : data.market.points.length === 0 ? 'Load market history' : 'Update market history'}
				</button>
				<button type="button" class="wl-strip-btn" onclick={() => (confirmRebuild = true)} disabled={working || confirmRebuild} data-testid="breadth-rebuild">Full rebuild</button>
				{#if st.failed > 0}
					<button type="button" class="wl-strip-btn" onclick={() => backfill({ retryFailed: true })} disabled={working}>Retry failed ({st.failed})</button>
				{/if}
			</div>
			{#if confirmRebuild}
				<div class="live-confirm" role="group" aria-label="Confirm full rebuild" data-testid="breadth-rebuild-confirm">
					<p>
						A full rebuild re-fetches the price history of every stock in the list and takes several
						slices of about 3 minutes each. Keep this page open until it says it is finished.
					</p>
					<div class="live-row">
						<button type="button" class="wl-strip-btn btn-primary" onclick={() => backfill({ rebuild: true })} disabled={working}>Start full rebuild</button>
						<button type="button" class="wl-strip-btn" onclick={() => (confirmRebuild = false)}>Cancel</button>
					</div>
				</div>
			{/if}
		{/if}
		<p class="hint live-status" role="status" data-testid="breadth-status">{backfilling || backfillMessage ? backfillMessage : (liveMessage ?? '')}</p>
	</section>

	{#if data.market.points.length > 0}
		<DmaBreadthChart points={data.market.points} computedAt={data.market.status.computedAt} liveAsOf={data.liveMarketDay} />
	{:else}
		<p class="scan-note" data-testid="dma-empty">
			The whole-market chart has no data yet.{isAdmin ? ' Use "Load market history" above.' : ' An admin has to load the price history first.'}
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
				<p class="hint">Scanner universe, as of {fmtLong(latest.asOf)}, {latest.total.toLocaleString('en-IN')} stocks measured. Overall read: <strong>{read}</strong>.</p>
				{#if headline.live}
					<p class="hint" data-testid="breadth-live-note">
						<strong class="live-tag">Live, provisional</strong> {stamp ? `updated ${stamp} IST ` : ''}&middot; final after the close &middot;
						{headline.live.total.toLocaleString('en-IN')} of {headline.typical.toLocaleString('en-IN')} stocks have a live quote.
					</p>
				{/if}
				{#if headline.partial}
					<p class="hint" data-testid="breadth-partial-note">
						{#if headline.partial.asOf === data.liveDay}
							{fmtDay(headline.partial.asOf)} is live but only {headline.partial.total.toLocaleString('en-IN')} of {headline.typical.toLocaleString('en-IN')} stocks have a quote so far, too few to show (a live day needs about half). Showing {fmtDay(latest.asOf)}.
						{:else}
							{fmtDay(headline.partial.asOf)} is still loading: {headline.partial.total.toLocaleString('en-IN')} of {headline.typical.toLocaleString('en-IN')} stocks have reported (a past day needs 90%). Showing {fmtDay(latest.asOf)}.
						{/if}
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
							<td class="text">{r.asOf}{#if r.asOf === data.liveDay}<span class="live-tag" style="margin-left: 0.75em" data-testid="breadth-live-row">Live, provisional ({r.total.toLocaleString('en-IN')})</span>{:else if headline.partialDates.has(r.asOf)}<span class="hint" style="margin-left: 0.75em" data-testid="breadth-partial-row">partial ({r.total.toLocaleString('en-IN')})</span>{/if}</td>
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

<style>
	.live-strip {
		display: flex;
		flex-direction: column;
		gap: 8px;
		margin: 0 0 16px;
		padding: 10px 12px;
		border: var(--border-w, 2px) solid var(--ink);
		background: var(--bg);
	}
	.live-row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px 12px;
	}
	.live-strip .hint,
	.live-confirm p {
		margin: 0;
	}
	.live-status:empty {
		display: none;
	}
	.live-confirm {
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 8px 10px;
		border: 1px dashed var(--ink);
		font-size: 0.875rem;
	}
	.live-tag {
		display: inline-block;
		padding: 1px 6px;
		border: 1.5px solid var(--ink);
		font-family: var(--font-mono);
		font-size: 0.6875rem;
		font-weight: 700;
		letter-spacing: 0.04em;
		text-transform: uppercase;
	}
</style>
