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
<p class="text-sm text-muted-fg mb-5">
	How the team's calls have worked out. Headline numbers use <strong>closed</strong> theses only; open theses are shown separately at the latest stored price.
</p>

{#snippet signed(v: number | null)}
	<span class={tone(v)}>{arrow(v)}{pct(v)}</span>{#if v != null}<span class="sr-only">{v > 0 ? ' gain' : v < 0 ? ' loss' : ' no change'}</span>{/if}
{/snippet}

<section class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-5" aria-label="Headline numbers" data-testid="headline">
	<div class="min-w-0 rounded-xl border border-border bg-surface p-4">
		<div class="text-xs text-muted-fg" title="Share of closed theses whose return from entry price to exit price is above zero. A flat 0.0% does not count as a win.">Hit rate <span aria-hidden="true">(?)</span></div>
		<div class="text-2xl font-bold mt-1" data-testid="hit-rate">{hit(sc.headline)}</div>
		<div class="text-xs text-muted-fg mt-1">closed theses with a positive return</div>
	</div>
	<div class="min-w-0 rounded-xl border border-border bg-surface p-4">
		<div class="text-xs text-muted-fg">Average return</div>
		<div class="text-2xl font-bold mt-1">{@render signed(sc.headline.avgReturn)}</div>
		<div class="text-xs text-muted-fg mt-1">entry to exit, closed theses</div>
	</div>
	<div class="min-w-0 rounded-xl border border-border bg-surface p-4">
		<div class="text-xs text-muted-fg" title="Average of (thesis return minus Nifty 50 return) over each thesis's own holding window, in percentage points. Theses older than the stored Nifty history are left out of this figure.">Average vs Nifty 50 <span aria-hidden="true">(?)</span></div>
		<div class="text-2xl font-bold mt-1">{@render signed(sc.headline.avgVsNifty)}</div>
		<div class="text-xs text-muted-fg mt-1">percentage points, same holding window</div>
	</div>
	<div class="min-w-0 rounded-xl border border-border bg-surface p-4">
		<div class="text-xs text-muted-fg">Average holding time</div>
		<div class="text-2xl font-bold mt-1">{days(sc.headline.avgHoldDays)}</div>
		<div class="text-xs text-muted-fg mt-1">closed theses</div>
	</div>
</section>

{#if sc.withoutEntryPrice.length}
	<details class="rounded-xl border border-dashed border-border p-3 mb-5 text-sm" data-testid="unpriced-note">
		<summary class="cursor-pointer"><strong>{sc.withoutEntryPrice.length}</strong> {sc.withoutEntryPrice.length === 1 ? 'thesis' : 'theses'} without an entry price (left out of every return figure)</summary>
		<ul class="mt-2 space-y-1">
			{#each sc.withoutEntryPrice as w (w.id)}
				<li>
					<a class="underline" href={companyHref(w.companyId, w.owner)}>{w.companyName}</a>
					<span class="text-muted-fg">&middot; {w.owner} &middot; {REASON[w.reason]}</span>
				</li>
			{/each}
		</ul>
	</details>
{/if}

<section class="mb-5" aria-labelledby="by-analyst">
	<h2 id="by-analyst" class="font-semibold mb-2">By analyst (closed theses)</h2>
	<div class="rounded-lg border border-border bg-surface relative overflow-x-auto">
		<table class="w-full text-sm min-w-[32rem]">
			<thead>
				<tr class="text-left text-xs text-muted-fg border-b border-border">
					<th class="p-2 font-medium">Analyst</th><th class="p-2 font-medium">Closed</th><th class="p-2 font-medium">Hit rate</th>
					<th class="p-2 font-medium">Avg return</th><th class="p-2 font-medium">Avg vs Nifty</th><th class="p-2 font-medium">Open</th>
				</tr>
			</thead>
			<tbody>
				{#each sc.byAnalyst as a (a.owner)}
					<tr class="border-b border-border last:border-0">
						<td class="p-2 font-medium">{a.owner}</td>
						<td class="p-2">{a.closed.count}</td>
						<td class="p-2">{hit(a.closed)}</td>
						<td class="p-2">{@render signed(a.closed.avgReturn)}</td>
						<td class="p-2">{@render signed(a.closed.avgVsNifty)}</td>
						<td class="p-2">{a.openCount}</td>
					</tr>
				{:else}
					<tr><td class="p-3 text-muted-fg" colspan="6">No theses yet.</td></tr>
				{/each}
			</tbody>
		</table>
	</div>
</section>

{#snippet sortTh(k: SortKey, label: string)}
	<th class="p-2 font-medium" aria-sort={ariaSort(k)}>
		<button type="button" class="font-medium hover:underline" onclick={() => sortBy(k)}>{label}{mark(k)}</button>
	</th>
{/snippet}

{#snippet thesisTable(rows: ScorecardRow[], title: string, endLabel: string, testid: string)}
	<h3 class="text-sm font-medium text-muted-fg mb-1">{title} ({rows.length})</h3>
	<div class="rounded-lg border border-border bg-surface relative overflow-x-auto mb-4" data-testid={testid}>
		<table class="w-full text-sm min-w-[56rem]">
			<thead>
				<tr class="text-left text-xs text-muted-fg border-b border-border">
					{@render sortTh('company', 'Company')}
					{@render sortTh('owner', 'Analyst')}
					{@render sortTh('conviction', 'Conviction')}
					{@render sortTh('entryDate', 'Entry')}
					<th class="p-2 font-medium">{endLabel}</th>
					{@render sortTh('returnPct', 'Return')}
					{@render sortTh('vsNifty', 'vs Nifty')}
					{@render sortTh('result', 'Result')}
				</tr>
			</thead>
			<tbody>
				{#each rows as r (r.id)}
					<tr class="border-b border-border last:border-0 align-top">
						<td class="p-2"><a class="font-medium hover:underline" href={companyHref(r.companyId, r.owner)}>{r.companyName}</a></td>
						<td class="p-2">{r.owner}</td>
						<td class="p-2">{r.conviction ?? '-'}</td>
						<td class="p-2">{r.entryDate ?? '-'}<br /><span class="text-muted-fg">{num(r.entryPrice)}</span></td>
						<td class="p-2">
							{#if r.endPrice != null}
								{r.endDate}<br /><span class="text-muted-fg">{num(r.endPrice)}{r.endSource === 'stored_close' ? ' (stored close)' : ''}</span>
							{:else}-{/if}
						</td>
						<td class="p-2 font-semibold">{@render signed(r.returnPct)}</td>
						<td class="p-2">{@render signed(r.vsNifty)}</td>
						<td class="p-2">{RESULT_LABEL[r.outcome] ?? r.outcome}</td>
					</tr>
				{:else}
					<tr><td class="p-3 text-muted-fg" colspan="8">None.</td></tr>
				{/each}
			</tbody>
		</table>
	</div>
{/snippet}

<section class="mb-5" aria-labelledby="all-theses">
	<div class="flex flex-wrap items-end justify-between gap-3 mb-2">
		<h2 id="all-theses" class="font-semibold">All theses</h2>
		<label class="text-sm">Analyst
			<select bind:value={analyst} class="ml-2 rounded-md border border-border px-2 py-1.5 text-sm" data-testid="analyst-filter">
				<option value="all">All analysts</option>
				{#each analysts as a (a)}<option value={a}>{a}</option>{/each}
			</select>
		</label>
	</div>
	{@render thesisTable(closedRows, 'Closed', 'Exit', 'closed-table')}
	{@render thesisTable(openRows, 'Open (paper return at the latest stored close)', 'Current', 'open-table')}
	<p class="text-xs text-muted-fg">
		Open theses: {sc.open.count} priced, hit rate {hit(sc.open)}, average return {pct(sc.open.avgReturn)}.
		{#if sc.withoutEndPrice}{sc.withoutEndPrice} priced thesis{sc.withoutEndPrice === 1 ? '' : 'es'} lack an exit or current price and show "-".{/if}
	</p>
</section>

{#snippet groupTable(title: string, groups: { key: string; stats: Stats }[])}
	<div class="min-w-0 rounded-xl border border-border bg-surface p-4">
		<h2 class="font-semibold mb-2">{title}</h2>
		<div class="relative overflow-x-auto">
			<table class="w-full text-sm min-w-[18rem]">
				<thead><tr class="text-left text-xs text-muted-fg"><th class="py-1 pr-2 font-medium">Group</th><th class="py-1 pr-2 font-medium">Closed</th><th class="py-1 pr-2 font-medium">Hit rate</th><th class="py-1 font-medium">Avg return</th></tr></thead>
				<tbody>
					{#each groups as g (g.key)}
						<tr class="border-t border-border"><td class="py-1 pr-2">{g.key}</td><td class="py-1 pr-2">{g.stats.count}</td><td class="py-1 pr-2">{hit(g.stats)}</td><td class="py-1">{@render signed(g.stats.avgReturn)}</td></tr>
					{:else}
						<tr><td class="py-2 text-muted-fg" colspan="4">No closed theses yet.</td></tr>
					{/each}
				</tbody>
			</table>
		</div>
	</div>
{/snippet}

{#snippet callList(title: string, rows: ScorecardRow[])}
	<h3 class="text-xs text-muted-fg">{title}</h3>
	{#each rows as r (r.id)}
		<div class="border-t border-border py-1 text-sm flex justify-between gap-2">
			<span><a class="hover:underline" href={companyHref(r.companyId, r.owner)}>{r.companyName}</a> <span class="text-muted-fg">&middot; {r.owner}</span></span>
			<span class="font-semibold shrink-0">{@render signed(r.returnPct)}</span>
		</div>
	{:else}
		<p class="text-sm text-muted-fg border-t border-border py-1">None yet.</p>
	{/each}
{/snippet}

<section class="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-5" aria-label="Insights">
	{@render groupTable('Return by conviction', sc.byConviction)}
	{@render groupTable('Return by sector', sc.bySector)}

	<div class="min-w-0 rounded-xl border border-border bg-surface p-4" data-testid="kill-triggers">
		<h2 class="font-semibold">Kill triggers (estimate)</h2>
		<p class="text-xs text-muted-fg mb-2">Closed theses where a kill trigger fired or the thesis was invalidated: return at exit versus the return had it been held to the latest stored price. An estimate from stored closes, not a result.</p>
		{#each sc.killTriggers as k (k.row.id)}
			<div class="border-t border-border py-2 text-sm">
				<a class="font-medium hover:underline" href={companyHref(k.row.companyId, k.row.owner)}>{k.row.companyName}</a>
				<span class="text-muted-fg">&middot; {k.row.owner}</span><br />
				At exit {@render signed(k.atExit)}, if held {@render signed(k.ifHeld)}:
				{#if k.difference > 0}exiting saved about {Math.abs(Math.round(k.difference * 10) / 10)} points{:else if k.difference < 0}exiting cost about {Math.abs(Math.round(k.difference * 10) / 10)} points{:else}no difference{/if}.
			</div>
		{:else}
			<p class="text-sm text-muted-fg border-t border-border pt-2">No closed thesis has exited on a kill trigger yet.</p>
		{/each}
	</div>

	<div class="min-w-0 rounded-xl border border-border bg-surface p-4" data-testid="best-worst">
		<h2 class="font-semibold mb-2">Best and worst calls (closed)</h2>
		{@render callList('Best 3', sc.best)}
		<div class="mt-2"></div>
		{@render callList('Worst 3', sc.worst)}
	</div>
</section>

<section class="mb-8" aria-labelledby="playbook" data-testid="playbook">
	<h2 id="playbook" class="font-semibold mb-2">Lessons learned (team playbook)</h2>
	<div class="min-w-0 rounded-xl border border-border bg-surface p-4">
		{#each sc.lessons as l (l.id)}
			<div class="border-t border-border first:border-0 py-2 text-sm">
				<p>{l.lesson}</p>
				<p class="text-xs text-muted-fg mt-0.5">
					<a class="hover:underline" href={companyHref(l.companyId, l.owner)}>{l.companyName}</a> &middot; {l.owner} &middot; {l.date ?? 'date not recorded'}
				</p>
			</div>
		{:else}
			<p class="text-sm text-muted-fg">No lessons yet. Add one in "Close Out Thesis" on a company page when you exit.</p>
		{/each}
	</div>
</section>
