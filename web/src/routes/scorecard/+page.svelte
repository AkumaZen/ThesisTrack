<script lang="ts">
	import { formatReturn } from '$lib/entryPrice.js';
	import type { ScorecardRow, Stats } from '$lib/scorecard';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	const sc = $derived(data.scorecard);

	let analyst = $state('all');
	type SortKey = 'company' | 'owner' | 'conviction' | 'entryDate' | 'returnPct' | 'vsNifty' | 'result';
	let sortKey = $state<SortKey>('returnPct');
	let sortDir = $state<1 | -1>(-1);

	const RESULT_LABEL: Record<string, string> = {
		open: 'Open',
		played_out: 'Played out',
		invalidated: 'Invalidated',
		exited_early: 'Exited early'
	};
	const analysts = $derived([...new Set(sc.rows.map((r) => r.owner))].sort((a, b) => a.localeCompare(b)));

	const sortValue = (r: ScorecardRow): string | number | null =>
		sortKey === 'company' ? r.companyName.toLowerCase()
		: sortKey === 'owner' ? r.owner.toLowerCase()
		: sortKey === 'conviction' ? r.conviction
		: sortKey === 'entryDate' ? r.entryDate
		: sortKey === 'result' ? (RESULT_LABEL[r.outcome] ?? r.outcome)
		: r[sortKey];

	// Rows without a figure always sink to the bottom, whichever way the column is sorted.
	let visible = $derived.by(() => {
		const rows = sc.rows.filter((r) => analyst === 'all' || r.owner === analyst);
		return rows.sort((a, b) => {
			const x = sortValue(a);
			const y = sortValue(b);
			if (x == null && y == null) return 0;
			if (x == null) return 1;
			if (y == null) return -1;
			return (x < y ? -1 : x > y ? 1 : 0) * sortDir;
		});
	});
	const closedRows = $derived(visible.filter((r) => r.closed));
	const openRows = $derived(visible.filter((r) => !r.closed));
	const openTotal = $derived(sc.rows.filter((r) => !r.closed).length);

	function sortBy(key: SortKey) {
		if (sortKey === key) sortDir = sortDir === 1 ? -1 : 1;
		else {
			sortKey = key;
			sortDir = key === 'company' || key === 'owner' ? 1 : -1;
		}
	}
	const ariaSort = (key: SortKey) => (sortKey === key ? (sortDir === 1 ? 'ascending' : 'descending') : 'none');
	const mark = (key: SortKey) => (sortKey === key ? (sortDir === 1 ? ' ▲' : ' ▼') : '');

	const pct = (v: number | null) => (v == null ? '-' : formatReturn(v));
	const arrow = (v: number | null) => (v == null ? '' : v > 0 ? '▲ ' : v < 0 ? '▼ ' : '■ ');
	const tone = (v: number | null) => (v == null ? '' : v > 0 ? 'text-good' : v < 0 ? 'text-danger' : '');
	const num = (v: number | null) => (v == null ? '-' : String(Math.round(v * 100) / 100));
	const days = (v: number | null) => (v == null ? '-' : `${Math.round(v)} days`);
	const hit = (s: Stats) => (s.hitRate == null ? '-' : `${Math.round(s.hitRate)}% (${s.wins} of ${s.count})`);
	const REASON: Record<string, string> = { no_entry_price: 'needs a price', no_data: 'no price data' };
	const companyHref = (id: string, owner: string) => `/company/${encodeURIComponent(id)}?owner=${encodeURIComponent(owner)}`;
</script>

<svelte:head><title>Scorecard - ThesisTrack</title></svelte:head>

<h1 class="page-title mb-1">Scorecard</h1>
<p class="text-sm text-muted-fg mb-1">How the team's calls have worked out.</p>
<details class="calm-disclosure sc-how">
	<summary>How this works</summary>
	<div class="calm-disclosure-body">
		<ul class="sc-notes">
			<li>Headline numbers use <strong>closed</strong> theses only. Open theses are shown separately at the latest stored close.</li>
			<li><strong>Hit rate</strong> is the share of closed theses whose return from entry price to exit price is above zero. A flat 0.0% does not count as a win.</li>
			<li><strong>vs Nifty</strong> is the average of thesis return minus Nifty 50 return over each thesis's own holding window, in percentage points. Theses older than the stored Nifty history are left out of this figure.</li>
			<li><strong>Kill triggers</strong> are an estimate: for closed theses where a kill trigger fired or the thesis was invalidated, the return at exit versus the return had it been held to the latest stored price. It is based on stored closes and is not a result.</li>
			<li>Theses without an entry price are excluded from every return figure.</li>
		</ul>
	</div>
</details>

{#snippet signed(v: number | null)}
	<span class={tone(v)}>{arrow(v)}{pct(v)}</span>{#if v != null}<span class="sr-only">{v > 0 ? ' gain' : v < 0 ? ' loss' : ' no change'}</span>{/if}
{/snippet}

<section class="sc-tiles" aria-label="Headline numbers" data-testid="headline">
	<div class="sc-tile">
		<div class="sc-tile-label">Hit rate</div>
		<div class="sc-tile-value" data-testid="hit-rate">{hit(sc.headline)}</div>
		<div class="sc-tile-sub">closed, positive return</div>
	</div>
	<div class="sc-tile">
		<div class="sc-tile-label">Average return</div>
		<div class="sc-tile-value">{@render signed(sc.headline.avgReturn)}</div>
		<div class="sc-tile-sub">entry to exit</div>
	</div>
	<div class="sc-tile">
		<div class="sc-tile-label">Average vs Nifty 50</div>
		<div class="sc-tile-value">{@render signed(sc.headline.avgVsNifty)}</div>
		<div class="sc-tile-sub">percentage points</div>
	</div>
	<div class="sc-tile">
		<div class="sc-tile-label">Average holding time</div>
		<div class="sc-tile-value">{days(sc.headline.avgHoldDays)}</div>
		<div class="sc-tile-sub">closed theses</div>
	</div>
</section>

<div class="calm-meta sc-meta">
	<span>{openTotal} open {openTotal === 1 ? 'thesis' : 'theses'}</span>
	{#if sc.withoutEntryPrice.length}
		<span aria-hidden="true">&middot;</span>
		<details class="sc-inline" data-testid="unpriced-note">
			<summary>{sc.withoutEntryPrice.length} without an entry price</summary>
			<ul>
				{#each sc.withoutEntryPrice as w (w.id)}
					<li>
						<a class="underline" href={companyHref(w.companyId, w.owner)}>{w.companyName}</a>
						<span>&middot; {w.owner} &middot; {REASON[w.reason]}</span>
					</li>
				{/each}
			</ul>
		</details>
	{/if}
</div>

{#snippet sortTh(k: SortKey, label: string)}
	<th aria-sort={ariaSort(k)}>
		<button type="button" class="font-medium hover:underline" onclick={() => sortBy(k)}>{label}{mark(k)}</button>
	</th>
{/snippet}

{#snippet dateCell(date: string | null, price: number | null, note: string)}
	{#if date == null && price == null}-{:else}{date ?? '-'}<br /><span class="text-muted-fg">{num(price)}{note}</span>{/if}
{/snippet}

{#snippet thesisTable(rows: ScorecardRow[], title: string, endLabel: string, testid: string, empty: string)}
	<div class="sc-subhead">
		<h3 class="sc-h3">{title} ({rows.length})</h3>
		{#if testid === 'open-table' && sc.open.count}
			<span class="calm-meta sc-subhead-meta">
				{sc.open.count} priced &middot; hit rate {hit(sc.open)} &middot; average return {pct(sc.open.avgReturn)}{#if sc.withoutEndPrice} &middot; {sc.withoutEndPrice} without a current price{/if}
			</span>
		{/if}
	</div>
	<div class="sc-wrap" data-testid={testid}>
		{#if rows.length}
			<table class="sc-table" style="min-width: 52rem">
				<thead>
					<tr>
						{@render sortTh('company', 'Company')}
						{@render sortTh('owner', 'Analyst')}
						{@render sortTh('conviction', 'Conviction')}
						{@render sortTh('entryDate', 'Entry')}
						<th>{endLabel}</th>
						{@render sortTh('returnPct', 'Return')}
						{@render sortTh('vsNifty', 'vs Nifty')}
						{@render sortTh('result', 'Result')}
					</tr>
				</thead>
				<tbody>
					{#each rows as r (r.id)}
						<tr class="align-top">
							<td><a class="font-medium hover:underline" href={companyHref(r.companyId, r.owner)}>{r.companyName}</a></td>
							<td>{r.owner}</td>
							<td>{r.conviction ?? '-'}</td>
							<td>{@render dateCell(r.entryDate, r.entryPrice, '')}</td>
							<td>{@render dateCell(r.endPrice != null ? r.endDate : null, r.endPrice, r.endSource === 'stored_close' ? ' (stored close)' : '')}</td>
							<td class="font-semibold">{@render signed(r.returnPct)}</td>
							<td>{@render signed(r.vsNifty)}</td>
							<td>{RESULT_LABEL[r.outcome] ?? r.outcome}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		{:else}
			<p class="sc-empty">{empty}</p>
		{/if}
	</div>
{/snippet}

<section class="sc-section" aria-labelledby="all-theses">
	<div class="sc-head">
		<h2 id="all-theses" class="sc-h2">Theses</h2>
		<div>
			<label class="sc-filter">Analyst
				<select bind:value={analyst} data-testid="analyst-filter">
					<option value="all">All analysts</option>
					{#each analysts as a (a)}<option value={a}>{a}</option>{/each}
				</select>
			</label>
		</div>
	</div>
	{@render thesisTable(closedRows, 'Closed', 'Exit', 'closed-table', 'No closed theses yet.')}
	{@render thesisTable(openRows, 'Open', 'Current', 'open-table', 'No open theses.')}
</section>

{#snippet groupTable(title: string, first: string, groups: { key: string; stats: Stats }[])}
	<div class="sc-subhead"><h3 class="sc-h3">{title}</h3></div>
	<div class="sc-wrap">
		{#if groups.length}
			<table class="sc-table" style="min-width: 28rem">
				<thead><tr><th>{first}</th><th>Closed</th><th>Hit rate</th><th>Avg return</th></tr></thead>
				<tbody>
					{#each groups as g (g.key)}
						<tr><td class="font-medium">{g.key}</td><td>{g.stats.count}</td><td>{hit(g.stats)}</td><td>{@render signed(g.stats.avgReturn)}</td></tr>
					{/each}
				</tbody>
			</table>
		{:else}
			<p class="sc-empty">No closed theses yet.</p>
		{/if}
	</div>
{/snippet}

<section class="sc-section" aria-labelledby="breakdown">
	<h2 id="breakdown" class="sc-h2">Breakdown</h2>
	<p class="sc-sub">Closed theses only.</p>

	<div class="sc-subhead"><h3 class="sc-h3">By analyst</h3></div>
	<div class="sc-wrap">
		{#if sc.byAnalyst.length}
			<table class="sc-table" style="min-width: 32rem">
				<thead>
					<tr><th>Analyst</th><th>Closed</th><th>Hit rate</th><th>Avg return</th><th>Avg vs Nifty</th><th>Open</th></tr>
				</thead>
				<tbody>
					{#each sc.byAnalyst as a (a.owner)}
						<tr>
							<td class="font-medium">{a.owner}</td>
							<td>{a.closed.count}</td>
							<td>{hit(a.closed)}</td>
							<td>{@render signed(a.closed.avgReturn)}</td>
							<td>{@render signed(a.closed.avgVsNifty)}</td>
							<td>{a.openCount}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		{:else}
			<p class="sc-empty">No theses yet.</p>
		{/if}
	</div>

	{@render groupTable('By conviction', 'Conviction', sc.byConviction)}
	{@render groupTable('By sector', 'Sector', sc.bySector)}
</section>

{#snippet callList(title: string, rows: ScorecardRow[])}
	<div class="min-w-0">
		<div class="sc-subhead"><h3 class="sc-h3">{title}</h3></div>
		{#each rows as r (r.id)}
			<div class="sc-row">
				<span><a class="hover:underline" href={companyHref(r.companyId, r.owner)}>{r.companyName}</a> <span class="text-muted-fg">&middot; {r.owner}</span></span>
				<span class="font-semibold shrink-0">{@render signed(r.returnPct)}</span>
			</div>
		{:else}
			<p class="sc-empty">None yet.</p>
		{/each}
	</div>
{/snippet}

<section class="sc-section" aria-labelledby="calls">
	<h2 id="calls" class="sc-h2">Calls</h2>
	<p class="sc-sub">Closed theses ranked by return, and exits on a kill trigger.</p>
	<div class="sc-two" data-testid="best-worst">
		{@render callList('Best 3', sc.best)}
		{@render callList('Worst 3', sc.worst)}
	</div>

	<div data-testid="kill-triggers">
		<div class="sc-subhead"><h3 class="sc-h3">Kill triggers (estimate)</h3></div>
		{#each sc.killTriggers as k (k.row.id)}
			<div class="sc-row sc-row-block">
				<a class="font-medium hover:underline" href={companyHref(k.row.companyId, k.row.owner)}>{k.row.companyName}</a>
				<span class="text-muted-fg">&middot; {k.row.owner}</span><br />
				At exit {@render signed(k.atExit)}, if held {@render signed(k.ifHeld)}:
				{#if k.difference > 0}exiting saved about {Math.abs(Math.round(k.difference * 10) / 10)} points{:else if k.difference < 0}exiting cost about {Math.abs(Math.round(k.difference * 10) / 10)} points{:else}no difference{/if}.
			</div>
		{:else}
			<p class="sc-empty">No closed thesis has exited on a kill trigger yet.</p>
		{/each}
	</div>
</section>

<section class="sc-section" aria-labelledby="playbook" data-testid="playbook">
	<h2 id="playbook" class="sc-h2">Lessons learned</h2>
	<p class="sc-sub">The team playbook, from closed theses.</p>
	{#each sc.lessons as l (l.id)}
		<div class="sc-row sc-row-block">
			<p>{l.lesson}</p>
			<p class="text-xs text-muted-fg mt-0.5">
				<a class="hover:underline" href={companyHref(l.companyId, l.owner)}>{l.companyName}</a> &middot; {l.owner} &middot; {l.date ?? 'date not recorded'}
			</p>
		</div>
	{:else}
		<p class="sc-empty">No lessons yet. Add one in "Close Out Thesis" on a company page when you exit.</p>
	{/each}
</section>

<style>
	.sc-how { margin-bottom: 1.25rem; }
	.sc-notes { margin: 0; padding-left: 1.1rem; list-style: disc; display: grid; gap: 0.35rem; }
	.sc-tiles { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1.25rem 1.5rem; }
	@media (min-width: 1024px) { .sc-tiles { grid-template-columns: repeat(4, minmax(0, 1fr)); } }
	.sc-tile { min-width: 0; border-top: 1px solid var(--rule); padding-top: 0.75rem; }
	.sc-tile-label { font-size: 0.75rem; color: var(--muted); }
	.sc-tile-value { font-size: 1.5rem; font-weight: 700; margin-top: 0.25rem; line-height: 1.2; }
	.sc-tile-sub { font-size: 0.75rem; color: var(--muted); margin-top: 0.25rem; }
	.sc-meta { margin-top: 1.25rem; display: flex; flex-wrap: wrap; align-items: baseline; gap: 0.25rem 0.5rem; margin-bottom: 2rem; }
	.sc-inline > summary { cursor: pointer; text-decoration: underline; text-underline-offset: 2px; }
	.sc-inline ul { list-style: none; padding: 0; margin: 0.5rem 0 0; font-size: 0.8125rem; }
	.sc-section { margin-bottom: 2.5rem; }
	.sc-h2 { font-size: 1.125rem; font-weight: 700; margin: 0 0 0.25rem; }
	.sc-head { display: flex; align-items: center; justify-content: space-between; gap: 0.75rem; margin-bottom: 0.5rem; }
	.sc-head .sc-h2 { margin: 0; }
	.sc-filter { display: flex; align-items: center; gap: 0.5rem; font-size: 0.8125rem; color: var(--muted); }
	.sc-filter select { width: auto; max-width: 12rem; min-height: 2.25rem; border: 1px solid var(--rule); background: var(--bg); color: var(--ink); font: inherit; font-size: 0.875rem; padding: 0.25rem 0.5rem; }
	.sc-sub { font-size: 0.8125rem; color: var(--muted); margin: 0 0 0.5rem; }
	.sc-h3 { font-size: 0.875rem; font-weight: 600; margin: 0; }
	.sc-subhead { display: flex; flex-wrap: wrap; align-items: baseline; gap: 0.25rem 0.75rem; margin: 1.25rem 0 0.25rem; }
	.sc-subhead-meta { margin: 0; }
	.sc-wrap { overflow-x: auto; position: relative; }
	.sc-table { width: 100%; font-size: 0.875rem; border-collapse: collapse; }
	.sc-table th { text-align: left; font-size: 0.75rem; font-weight: 500; color: var(--muted); padding: 0.375rem 0.75rem 0.375rem 0; border-bottom: 1px solid var(--rule); white-space: nowrap; }
	.sc-table td { padding: 0.5rem 0.75rem 0.5rem 0; }
	.sc-table tbody tr + tr td { border-top: 1px solid var(--rule); }
	.sc-empty { font-size: 0.875rem; color: var(--muted); margin: 0.25rem 0 0; }
	.sc-two { display: grid; grid-template-columns: minmax(0, 1fr); gap: 0 2rem; }
	@media (min-width: 1024px) { .sc-two { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
	.sc-row { display: flex; justify-content: space-between; gap: 0.5rem; padding: 0.4rem 0; font-size: 0.875rem; border-top: 1px solid var(--rule); }
	.sc-row-block { display: block; padding: 0.6rem 0; }
</style>
