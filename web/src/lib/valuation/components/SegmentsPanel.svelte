<script lang="ts">
	// Business segment financials from Screener, read from the stored copy. Editors can reload it; a
	// page view never calls Screener. Screener shows the segment numbers to premium accounts only.
	import { SEGMENT_LINES, salesShares, type SegmentData } from '$lib/valuation/segments';

	let {
		symbol,
		initial,
		canLoad
	}: {
		symbol: string;
		initial: { data: SegmentData; fetchedAt: number } | null;
		canLoad: boolean;
	} = $props();

	let stored = $state<{ data: SegmentData; fetchedAt: number } | null>(null);
	// Follows the loaded page data (another company, or a reload), and holds a fresh load until then.
	$effect(() => {
		stored = initial;
	});
	let busy = $state(false);
	let error = $state<string | null>(null);
	let line = $state<string>('Sales');

	async function load() {
		busy = true;
		error = null;
		try {
			const res = await fetch(`/api/valuation/company/${encodeURIComponent(symbol)}/segments`, { method: 'POST' });
			const body = await res.json().catch(() => null);
			if (!res.ok) throw new Error(body?.message ?? `HTTP ${res.status}`);
			stored = body.segments;
		} catch (e) {
			error = e instanceof Error ? e.message : 'Could not load segments.';
		} finally {
			busy = false;
		}
	}

	const data = $derived(stored?.data ?? null);
	const table = $derived(data?.status === 'ok' ? data : null);
	const lines = $derived(table ? SEGMENT_LINES.filter((l) => table.lines[l]) : []);
	const shares = $derived(table ? salesShares(table) : []);
	const fmt = (v: number | null) => (v == null ? '-' : v.toLocaleString('en-IN', { maximumFractionDigits: 1 }));
	const when = $derived(stored ? new Date(stored.fetchedAt).toLocaleDateString('en-IN') : '');
</script>

<div class="stage-panel seg-panel" data-testid="segments-panel">
	<div class="depth-head">
		<span class="exhibit-cap" style="margin:0">Segment financials (Screener)</span>
		{#if canLoad}
			<button type="button" class="wl-strip-btn no-print" onclick={load} disabled={busy} data-testid="segments-load">
				{busy ? 'Loading...' : stored ? 'Reload' : 'Load segments'}
			</button>
		{/if}
	</div>
	{#if error}<p class="price-error" role="alert">{error}</p>{/if}

	{#if !stored}
		<p class="scan-note">Not loaded yet.{canLoad ? ' Press "Load segments" to fetch them from Screener.' : ' An editor can load them.'}</p>
	{:else if data?.status === 'none'}
		<p class="scan-note">Screener lists no business segments for this company (loaded {when}).</p>
	{:else if data?.status === 'premium'}
		<p class="scan-note" data-testid="segments-premium">
			Screener shows these segment numbers to premium accounts only, so only the names are available (loaded {when}).
		</p>
		<ul class="seg-names">
			{#each data.segments as s (s)}<li>{s}</li>{/each}
		</ul>
	{:else if table}
		<div class="preset-chips" role="group" aria-label="Segment measure">
			{#each lines as l (l)}
				<button type="button" class="tag" class:tag-on={line === l} aria-pressed={line === l} onclick={() => (line = l)}>{l}</button>
			{/each}
		</div>
		<div class="table-scroll">
			<table class="res-table" data-testid="segments-table">
				<thead>
					<tr>
						<th class="text">Segment</th>
						{#each table.years as y (y)}<th>{y}</th>{/each}
						{#if line === 'Sales'}<th title="Share of the latest year's positive segment sales">Share</th>{/if}
					</tr>
				</thead>
				<tbody>
					{#each table.segments as s, i (s)}
						<tr>
							<td class="text res-name">{s}</td>
							{#each table.lines[line]?.[i] ?? [] as v, k (k)}<td class="num">{fmt(v)}</td>{/each}
							{#if line === 'Sales'}<td class="num">{shares[i]?.sharePct == null ? '-' : `${shares[i].sharePct!.toFixed(0)}%`}</td>{/if}
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
		<p class="hint">Rs crore, {table.consolidated ? 'consolidated' : 'standalone'}, loaded {when}.</p>
	{/if}
</div>
