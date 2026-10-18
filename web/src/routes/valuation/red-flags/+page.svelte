<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { canWrite } from '$lib/auth';
	import StatusBadge from '$lib/valuation/components/StatusBadge.svelte';
	import { runBatches } from '$lib/valuation/concallClient';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	type Key = 'company' | 'score' | 'credibility';
	let query = $state('');
	let sector = $state('');
	let watchlist = $state('');
	let level = $state('');
	let sortKey = $state<Key>('score');
	let sortDir = $state<'asc' | 'desc'>('desc');
	let busy = $state(false);
	let status = $state<{ ok: boolean; text: string } | null>(null);

	const writable = $derived(canWrite(data.user?.role));
	const symbols = $derived(watchlist ? new Set(data.watchlists.find((w) => w.id === watchlist)?.symbols ?? []) : null);
	const visible = $derived.by(() => {
		const q = query.trim().toLowerCase();
		const rows = data.rows.filter(
			(r) =>
				(!sector || r.sector === sector) &&
				(!level || r.level === level) &&
				(!symbols || symbols.has(r.symbol)) &&
				(!q || `${r.name} ${r.symbol} ${r.sector} ${r.failed.join(' ')}`.toLowerCase().includes(q))
		);
		const value = (r: (typeof rows)[number]) => (sortKey === 'company' ? r.name.toLowerCase() : sortKey === 'score' ? r.score : r.credibilityPct);
		const sign = sortDir === 'asc' ? 1 : -1;
		return rows.sort((a, b) => {
			const x = value(a),
				y = value(b);
			if (x == null || y == null) return x == null && y == null ? a.name.localeCompare(b.name) : x == null ? 1 : -1;
			const c = typeof x === 'string' ? x.localeCompare(y as string) : (x as number) - (y as number);
			return c ? c * sign : a.name.localeCompare(b.name);
		});
	});

	function sortBy(key: Key) {
		if (sortKey === key) sortDir = sortDir === 'asc' ? 'desc' : 'asc';
		else {
			sortKey = key;
			sortDir = key === 'company' ? 'asc' : 'desc';
		}
	}
	const ariaSort = (key: Key) => (sortKey === key ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none');
	const arrow = (key: Key) => (sortKey === key ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '');

	async function refresh() {
		busy = true;
		status = null;
		const result = await runBatches('refresh', undefined, (text) => (status = { ok: true, text }));
		status = { ok: result.ok, text: result.message };
		if (result.changed) await invalidateAll();
		busy = false;
	}
</script>

<svelte:head>
	<title>Red flags - ThesisTrack</title>
</svelte:head>

<div class="band">
	<div class="band-inner">
		<h1>Red flags and guidance credibility</h1>
		<div class="sub">
			Transparent checks on the stored financials, with the inputs of every check, next to how often management kept its stated guidance.
		</div>
	</div>
</div>

<div class="wrap wrap-wide rf">
	<nav class="rf-links" aria-label="Related pages">
		<a href={resolve('/valuation/concalls')}>Concalls by quarter</a>
		<a href={resolve('/valuation/master-tracker')}>Master Tracker</a>
	</nav>

	<form class="rf-bar" role="search" onsubmit={(e) => e.preventDefault()}>
		<label class="rf-field rf-search">
			<span>Search</span>
			<input class="sm-input" type="search" bind:value={query} placeholder="Company, ticker, sector or a failed check" />
		</label>
		<label class="rf-field">
			<span>Sector</span>
			<select class="sm-input" bind:value={sector}>
				<option value="">All sectors</option>
				{#each data.sectors as s (s)}<option value={s}>{s}</option>{/each}
			</select>
		</label>
		<label class="rf-field">
			<span>Watchlist</span>
			<select class="sm-input" bind:value={watchlist}>
				<option value="">All tracked companies</option>
				{#each data.watchlists as w (w.id)}<option value={w.id}>{w.name}</option>{/each}
			</select>
		</label>
		<label class="rf-field">
			<span>Level</span>
			<select class="sm-input" bind:value={level}>
				<option value="">All levels</option>
				<option value="high">High</option>
				<option value="watch">Watch</option>
				<option value="clean">Clean</option>
				<option value="insufficient">Not enough data</option>
			</select>
		</label>
		<label class="rf-field">
			<span>Sort by</span>
			<span class="rf-sortrow">
				<select class="sm-input" value={sortKey} onchange={(e) => (sortKey = e.currentTarget.value as Key)}>
					<option value="score">Red-flag score</option>
					<option value="credibility">Guidance kept</option>
					<option value="company">Company</option>
				</select>
				<button type="button" class="sm-btn rf-dir" onclick={() => (sortDir = sortDir === 'asc' ? 'desc' : 'asc')} aria-label="Sort direction: {sortDir === 'asc' ? 'ascending' : 'descending'}">
					{sortDir === 'asc' ? 'Asc' : 'Desc'}
				</button>
			</span>
		</label>
	</form>

	{#if writable}
		<section class="rf-actions" aria-label="Refresh">
			<button type="button" class="sm-btn" disabled={busy} onclick={refresh}>
				Refresh checks{data.unscanned.length ? ` (${data.unscanned.length} not scanned)` : ''}
			</button>
			<span class="sm-hint">Reads Screener and applies the rules. No model is used.</span>
		</section>
	{/if}
	<p class="rf-status sm-msg" class:sm-msg-error={status && !status.ok} role="status" aria-live="polite">{status?.text ?? ''}</p>

	{#if data.rows.length === 0}
		<p class="sm-empty" data-testid="redflags-empty">
			No company has been scanned yet.{writable ? ' Press "Refresh checks" to start.' : ' Ask an analyst to refresh the checks.'}
		</p>
	{:else}
		<p class="sm-hint" aria-live="polite">{visible.length} of {data.rows.length} companies{data.unscanned.length ? `; ${data.unscanned.length} not scanned yet` : ''}.</p>
		<div class="rf-table" role="table" aria-label="Red flags by company" data-testid="redflag-table">
			<div class="rf-head" role="rowgroup">
				<div role="row">
					<div role="columnheader" aria-sort={ariaSort('company')}>
						<button type="button" class="rf-sort" onclick={() => sortBy('company')}>Company{arrow('company')}</button>
					</div>
					<div role="columnheader" aria-sort={ariaSort('score')}>
						<button type="button" class="rf-sort" onclick={() => sortBy('score')}>Red-flag score{arrow('score')}</button>
					</div>
					<div role="columnheader">Failed checks</div>
					<div role="columnheader" aria-sort={ariaSort('credibility')}>
						<button type="button" class="rf-sort" onclick={() => sortBy('credibility')}>Guidance kept{arrow('credibility')}</button>
					</div>
				</div>
			</div>
			<div role="rowgroup">
				{#each visible as r (r.symbol)}
					<div role="row" class="rf-row">
						<div role="cell">
							<a class="rf-name" href={resolve('/valuation/concalls/[symbol]', { symbol: r.symbol })}>{r.name}</a>
							<span class="rf-sub">{r.symbol}{r.sector ? ` · ${r.sector}` : ''}</span>
						</div>
						<div role="cell" data-label="Red-flag score">
							<span class="rf-scoreline"><strong class="rf-num">{r.score == null ? 'n/a' : r.score}</strong><StatusBadge status={r.level} /></span>
							<span class="rf-sub">{r.passed} passed, {r.failed.length} failed, {r.na} no data</span>
						</div>
						<div role="cell" data-label="Failed checks">
							{#if r.failed.length}
								<ul class="rf-fails">
									{#each r.failed as f (f)}<li>{f}</li>{/each}
								</ul>
							{:else}
								<span class="rf-muted">None</span>
							{/if}
						</div>
						<div role="cell" data-label="Guidance kept">
							{#if r.credibilityPct == null}
								<span class="rf-muted">{r.resolved ? 'n/a' : 'Nothing resolved yet'}</span>
							{:else}
								<strong class="rf-num">{r.credibilityPct}%</strong>
								<span class="rf-sub">of {r.resolved} resolved</span>
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
	.rf {
		display: grid;
		gap: 0.9rem;
		padding-top: 1rem;
	}
	.rf-links {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem 1.2rem;
		font-weight: 600;
	}
	.rf-links a {
		display: inline-flex;
		align-items: center;
		min-height: 2.75rem;
	}
	.rf-bar {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(10.5rem, 1fr));
		gap: 0.6rem;
		border: var(--border-w) solid var(--ink);
		padding: 0.7rem;
		background: var(--bg);
	}
	.rf-search {
		grid-column: 1 / -1;
	}
	.rf-field {
		display: grid;
		gap: 0.2rem;
		font: 600 0.72rem/1.2 var(--font-display, inherit);
		text-transform: uppercase;
		letter-spacing: 0.04em;
		min-width: 0;
	}
	.rf-field :global(.sm-input) {
		min-height: 2.75rem;
		width: 100%;
		text-transform: none;
		letter-spacing: 0;
	}
	.rf-sortrow {
		display: flex;
		gap: 0.4rem;
	}
	.rf-sortrow :global(select) {
		flex: 1;
	}
	.rf-dir {
		min-height: 2.75rem;
		min-width: 3.5rem;
	}
	.rf-actions {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem 0.7rem;
	}
	.rf-actions :global(.sm-btn) {
		min-height: 2.75rem;
	}
	.rf-actions .sm-hint {
		margin: 0;
	}
	.rf-status {
		margin: 0;
		min-height: 1.2em;
	}
	.rf-table {
		border: var(--border-w) solid var(--ink);
		background: var(--bg);
		box-shadow: var(--shadow-hard-sm);
		min-width: 0;
	}
	.rf-head {
		display: none;
	}
	.rf-row {
		display: grid;
		gap: 0.45rem;
		padding: 0.8rem;
		border-top: 2px solid var(--ink);
	}
	.rf-row:first-child {
		border-top: 0;
	}
	[role='cell'] {
		min-width: 0;
		overflow-wrap: anywhere;
		display: grid;
		gap: 0.15rem;
		align-content: start;
		justify-items: start;
	}
	[role='cell'][data-label]::before {
		content: attr(data-label);
		font: 600 0.68rem/1.2 var(--font-display, inherit);
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--muted);
	}
	.rf-name {
		font-weight: 700;
		font-size: 1rem;
		display: inline-flex;
		align-items: center;
		min-height: 2.75rem;
	}
	.rf-sub {
		font: 0.75rem/1.3 var(--font-mono, monospace);
		color: var(--muted);
	}
	.rf-muted {
		color: var(--muted);
		font-size: 0.85rem;
	}
	.rf-num {
		font: 700 1.2rem/1.2 var(--font-mono, monospace);
	}
	.rf-scoreline {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
	}
	.rf-fails {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem;
	}
	.rf-fails li {
		border: 2px solid var(--danger);
		color: var(--danger);
		background: var(--danger-soft);
		padding: 0.05rem 0.4rem;
		font-size: 0.78rem;
		font-weight: 600;
	}
	.rf-sort {
		all: unset;
		cursor: pointer;
		font: 700 0.72rem/1.2 var(--font-display, inherit);
		text-transform: uppercase;
		letter-spacing: 0.04em;
		min-height: 2.75rem;
		display: inline-flex;
		align-items: center;
	}
	.rf-sort:focus-visible {
		outline: 3px solid var(--accent);
		outline-offset: 1px;
	}
	@media (min-width: 800px) {
		.rf-head {
			display: block;
			background: var(--surface);
			border-bottom: 2px solid var(--ink);
		}
		.rf-head [role='row'],
		.rf-row {
			display: grid;
			grid-template-columns: minmax(11rem, 1.6fr) 12rem minmax(12rem, 2fr) 9rem;
			gap: 0.8rem;
			align-items: start;
			padding: 0.7rem 0.8rem;
		}
		.rf-head [role='row'] {
			padding-top: 0;
			padding-bottom: 0;
		}
		.rf-head [role='columnheader'] {
			display: flex;
			align-items: center;
			font: 700 0.72rem/1.2 var(--font-display, inherit);
			text-transform: uppercase;
			letter-spacing: 0.04em;
		}
		[role='cell'][data-label]::before {
			display: none;
		}
		.rf-name {
			min-height: 0;
		}
	}
</style>
