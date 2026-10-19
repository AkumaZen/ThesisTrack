<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { canWrite } from '$lib/auth';
	import StatusBadge from '$lib/valuation/components/StatusBadge.svelte';
	import { runBatches } from '$lib/valuation/concallClient';
	import { filterRows, quarterLabel, sortRows, type SortKey } from '$lib/valuation/concall/rows';
	import { formatMeetingDay } from '$lib/valuation/boardMeetings';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let query = $state('');
	let quarter = $state('');
	let sector = $state('');
	let watchlist = $state('');
	let sortKey = $state<SortKey>('quarter');
	let sortDir = $state<'asc' | 'desc'>('desc');
	let busy = $state(false);
	let status = $state<{ ok: boolean; text: string } | null>(null);

	const writable = $derived(canWrite(data.user?.role));
	const quarters = $derived([...new Set(data.rows.map((r) => r.quarter))].sort().reverse());
	const symbols = $derived(watchlist ? new Set(data.watchlists.find((w) => w.id === watchlist)?.symbols ?? []) : null);
	const visible = $derived(sortRows(filterRows(data.rows, { query, quarter, sector, symbols }), sortKey, sortDir));

	const COLUMNS: { key: SortKey; label: string }[] = [
		{ key: 'company', label: 'Company' },
		{ key: 'quarter', label: 'Quarter' },
		{ key: 'quality', label: 'Result quality' },
		{ key: 'sentiment', label: 'Sentiment' },
		{ key: 'congratulations', label: 'Congrats' },
		{ key: 'next', label: 'Next call' }
	];

	function sortBy(key: SortKey) {
		if (sortKey === key) sortDir = sortDir === 'asc' ? 'desc' : 'asc';
		else { sortKey = key; sortDir = key === 'company' || key === 'next' ? 'asc' : 'desc'; }
	}
	const ariaSort = (key: SortKey) => (sortKey === key ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none');
	const signed = (n: number) => (n > 0 ? `+${n}` : String(n));
	const pts = (n: number | null) => (n == null ? '' : `${n > 0 ? '+' : ''}${n.toFixed(1)} pts`);

	async function run(mode: 'refresh' | 'analyse') {
		busy = true;
		status = null;
		const result = await runBatches(mode, undefined, (text) => (status = { ok: true, text }));
		status = { ok: result.ok, text: result.message };
		if (result.changed) await invalidateAll();
		busy = false;
	}
</script>

<svelte:head>
	<title>Concalls - ThesisTrack</title>
</svelte:head>

<div class="band">
	<div class="band-inner">
		<h1>Concalls</h1>
		<div class="sub">
			One row per company and quarter for the companies in the Master Tracker. Result quality is computed from the
			stored financials; sentiment and key points come from one model read of each transcript, saved once.
		</div>
	</div>
</div>

<div class="wrap wrap-wide cc">
	<nav class="cc-links" aria-label="Related pages">
		<a href={resolve('/valuation/red-flags')}>Red flags and guidance credibility</a>
		<a href={resolve('/valuation/master-tracker')}>Master Tracker</a>
	</nav>

	<form class="cc-bar" role="search" onsubmit={(e) => e.preventDefault()}>
		<label class="cc-field cc-search">
			<span>Search</span>
			<input class="sm-input" type="search" bind:value={query} placeholder="Company, ticker, sector or a key point" />
		</label>
		<label class="cc-field">
			<span>Quarter</span>
			<select class="sm-input" bind:value={quarter}>
				<option value="">All quarters</option>
				{#each quarters as q (q)}<option value={q}>{quarterLabel(q)}</option>{/each}
			</select>
		</label>
		<label class="cc-field">
			<span>Sector</span>
			<select class="sm-input" bind:value={sector}>
				<option value="">All sectors</option>
				{#each data.sectors as s (s)}<option value={s}>{s}</option>{/each}
			</select>
		</label>
		<label class="cc-field">
			<span>Watchlist</span>
			<select class="sm-input" bind:value={watchlist}>
				<option value="">All tracked companies</option>
				{#each data.watchlists as w (w.id)}<option value={w.id}>{w.name}</option>{/each}
			</select>
		</label>
		<label class="cc-field">
			<span>Sort by</span>
			<span class="cc-sortrow">
				<select class="sm-input" value={sortKey} onchange={(e) => (sortKey = e.currentTarget.value as SortKey)}>
					{#each COLUMNS as c (c.key)}<option value={c.key}>{c.label}</option>{/each}
				</select>
				<button type="button" class="sm-btn cc-dir" onclick={() => (sortDir = sortDir === 'asc' ? 'desc' : 'asc')} aria-label="Sort direction: {sortDir === 'asc' ? 'ascending' : 'descending'}">
					{sortDir === 'asc' ? 'Asc' : 'Desc'}
				</button>
			</span>
		</label>
	</form>

	{#if writable}
		<section class="cc-actions" aria-label="Refresh and analyse">
			<button type="button" class="sm-btn" disabled={busy} onclick={() => run('refresh')}>
				Refresh checks{data.unscanned.length ? ` (${data.unscanned.length} not scanned)` : ''}
			</button>
			<button type="button" class="sm-btn sm-btn-primary" disabled={busy || data.pending === 0} onclick={() => run('analyse')}>
				Analyse {data.pending} new {data.pending === 1 ? 'transcript' : 'transcripts'}
			</button>
			<span class="sm-hint">
				Refresh reads Screener and applies the rules, with no model. Analyse sends each new transcript to the model once, 3 at a time,
				and never repeats a saved one.
			</span>
		</section>
	{/if}
	<p class="cc-status sm-msg" class:sm-msg-error={status && !status.ok} role="status" aria-live="polite">{status?.text ?? ''}</p>

	{#if data.companyCount === 0}
		<p class="sm-empty">No companies in the Master Tracker yet. Add one there first.</p>
	{:else if data.rows.length === 0}
		<p class="sm-empty" data-testid="concalls-empty">
			{data.unscanned.length} {data.unscanned.length === 1 ? 'company has' : 'companies have'} not been scanned yet.
			{writable ? 'Press "Refresh checks" to read their financials and find stored transcripts.' : 'Ask an analyst to refresh the checks.'}
		</p>
	{:else}
		<p class="sm-hint" aria-live="polite">{visible.length} of {data.rows.length} rows{data.unscanned.length ? `; ${data.unscanned.length} companies not scanned yet` : ''}.</p>
		<div class="cc-table" role="table" aria-label="Concalls by company and quarter" data-testid="concall-table">
			<div class="cc-head" role="rowgroup">
				<div role="row">
					{#each COLUMNS as c (c.key)}
						<div role="columnheader" aria-sort={ariaSort(c.key)} class="cc-col-{c.key}">
							<button type="button" class="cc-sort" onclick={() => sortBy(c.key)}>
								{c.label}<span aria-hidden="true">{sortKey === c.key ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''}</span>
							</button>
						</div>
					{/each}
					<div role="columnheader" class="cc-col-points">Key positives and negatives</div>
				</div>
			</div>
			<div role="rowgroup">
				{#each visible as r (r.key)}
					<div role="row" class="cc-row">
						<div role="cell" class="cc-col-company" data-label="Company">
							<a class="cc-name" href={resolve('/valuation/concalls/[symbol]', { symbol: r.symbol })}>{r.name}</a>
							<span class="cc-sub">{r.symbol}{r.sector ? ` · ${r.sector}` : ''}</span>
						</div>
						<div role="cell" class="cc-col-quarter" data-label="Quarter">{quarterLabel(r.quarter)}</div>
						<div role="cell" class="cc-col-quality" data-label="Result quality">
							{#if r.quality}
								<StatusBadge status={r.quality.verdict} />
								<span class="cc-sub" title={r.quality.metrics.map((m) => `${m.name}: ${m.yoy == null ? 'n/a' : m.yoy.toFixed(0) + '% YoY'} vs ${m.trend == null ? 'n/a' : m.trend.toFixed(0) + '% trend'}`).join('; ')}>
									{r.quality.opm == null ? '' : `OPM ${r.quality.opm.toFixed(0)}%`}{r.quality.opmChange == null ? '' : ` (${pts(r.quality.opmChange)})`}
								</span>
							{:else}
								<span class="cc-muted">No results stored</span>
							{/if}
						</div>
						<div role="cell" class="cc-col-sentiment" data-label="Sentiment">
							{#if r.analysed && r.sentiment != null}
								<strong class="cc-score" class:cc-pos={r.sentiment > 20} class:cc-neg={r.sentiment < -20}>{signed(r.sentiment)}</strong>
								<span class="cc-sub">{r.tone}</span>
							{:else if r.hasTranscript}
								<span class="cc-muted">Not analysed</span>
							{:else}
								<span class="cc-muted">No transcript stored</span>
							{/if}
						</div>
						<div role="cell" class="cc-col-congratulations" data-label="Congrats">
							{r.congratulations == null ? 'n/a' : r.congratulations}
						</div>
						<div role="cell" class="cc-col-next" data-label="Next call">
							{#if r.next}
								<span>{formatMeetingDay(r.next.date)}</span><span class="cc-sub">{r.next.kind}</span>
							{:else}
								<span class="cc-muted">None announced</span>
							{/if}
						</div>
						<div role="cell" class="cc-col-points" data-label="Key points">
							{#if r.analysed && (r.positives.length || r.negatives.length)}
								<ul class="cc-points">
									{#each r.positives as p (p)}<li class="cc-up"><span class="cc-mark">Positive</span> {p}</li>{/each}
									{#each r.negatives as n (n)}<li class="cc-down"><span class="cc-mark">Negative</span> {n}</li>{/each}
								</ul>
							{:else}
								<span class="cc-muted">{r.analysed ? 'None noted' : 'n/a'}</span>
							{/if}
						</div>
					</div>
				{:else}
					<p class="sm-empty">Nothing matches these filters.</p>
				{/each}
			</div>
		</div>
	{/if}
</div>

<style>
	.cc {
		display: grid;
		gap: 0.9rem;
		padding-top: 1rem;
	}
	.cc-links {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem 1.2rem;
		font-weight: 600;
	}
	.cc-links a {
		display: inline-flex;
		align-items: center;
		min-height: 2.75rem;
	}
	.cc-bar {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(13.5rem, 1fr));
		gap: 0.6rem;
		border: var(--border-w) solid var(--ink);
		padding: 0.7rem;
		background: var(--bg);
	}
	.cc-search {
		grid-column: 1 / -1;
	}
	.cc-field {
		display: grid;
		gap: 0.2rem;
		font: 600 0.72rem/1.2 var(--font-display, inherit);
		text-transform: uppercase;
		letter-spacing: 0.04em;
		min-width: 0;
	}
	.cc-field :global(.sm-input) {
		min-height: 2.75rem;
		width: 100%;
		text-transform: none;
		letter-spacing: 0;
	}
	.cc-sortrow {
		display: flex;
		gap: 0.4rem;
	}
	.cc-sortrow :global(select) {
		flex: 1;
	}
	.cc-dir {
		min-height: 2.75rem;
		min-width: 3.5rem;
	}
	.cc-actions {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem 0.7rem;
	}
	.cc-actions :global(.sm-btn) {
		min-height: 2.75rem;
		white-space: normal;
	}
	.cc-actions .sm-hint {
		flex-basis: 100%;
		margin: 0;
	}
	.cc-status {
		margin: 0;
		min-height: 1.2em;
	}
	.cc-table {
		border: var(--border-w) solid var(--ink);
		background: var(--bg);
		box-shadow: var(--shadow-hard-sm);
		min-width: 0;
	}
	.cc-head {
		display: none;
	}
	.cc-row {
		display: grid;
		gap: 0.45rem;
		padding: 0.8rem;
		border-top: 2px solid var(--ink);
	}
	.cc-row:first-child {
		border-top: 0;
	}
	[role='cell'] {
		min-width: 0;
		overflow-wrap: anywhere;
		display: grid;
		gap: 0.1rem;
		align-content: start;
		justify-items: start;
	}
	[role='cell']::before {
		content: attr(data-label);
		font: 600 0.68rem/1.2 var(--font-display, inherit);
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--muted);
	}
	.cc-col-company::before {
		display: none;
	}
	.cc-name {
		font-weight: 700;
		font-size: 1rem;
		display: inline-flex;
		align-items: center;
		min-height: 2.75rem;
	}
	.cc-sub {
		font: 0.75rem/1.3 var(--font-mono, monospace);
		color: var(--muted);
	}
	.cc-muted {
		color: var(--muted);
		font-size: 0.85rem;
	}
	.cc-score {
		font: 700 1.1rem/1.2 var(--font-mono, monospace);
	}
	.cc-pos {
		color: var(--good);
	}
	.cc-neg {
		color: var(--danger);
	}
	.cc-points {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 0.25rem;
		font-size: 0.85rem;
	}
	.cc-mark {
		font: 700 0.65rem/1 var(--font-display, inherit);
		text-transform: uppercase;
		letter-spacing: 0.04em;
		margin-right: 0.3rem;
	}
	.cc-up .cc-mark {
		color: var(--good);
	}
	.cc-down .cc-mark {
		color: var(--danger);
	}
	.cc-sort {
		all: unset;
		cursor: pointer;
		font: 700 0.72rem/1.2 var(--font-display, inherit);
		text-transform: uppercase;
		letter-spacing: 0.04em;
		min-height: 2.75rem;
		display: inline-flex;
		align-items: center;
	}
	.cc-sort:focus-visible {
		outline: 3px solid var(--accent);
		outline-offset: 1px;
	}
	@media (min-width: 900px) {
		.cc-head {
			display: block;
			background: var(--surface);
			border-bottom: 2px solid var(--ink);
		}
		.cc-head [role='row'],
		.cc-row {
			display: grid;
			grid-template-columns: minmax(10rem, 1.5fr) 5.5rem 8.5rem 6.5rem 5rem 7.5rem minmax(14rem, 2.4fr);
			gap: 0.6rem;
			align-items: start;
		}
		.cc-head [role='row'] {
			padding: 0 0.8rem;
		}
		.cc-head [role='columnheader'] {
			min-height: 2.75rem;
			display: flex;
			align-items: center;
			font: 700 0.72rem/1.2 var(--font-display, inherit);
			text-transform: uppercase;
			letter-spacing: 0.04em;
		}
		[role='cell']::before {
			display: none;
		}
		.cc-row {
			padding: 0.7rem 0.8rem;
		}
		.cc-name {
			min-height: 0;
		}
	}
</style>
