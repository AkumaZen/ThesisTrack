<script lang="ts">
	import { resolve } from '$app/paths';
	import { invalidateAll } from '$app/navigation';
	import { flip } from 'svelte/animate';
	import CardMetricsChooser from '$lib/valuation/components/CardMetricsChooser.svelte';
	import { DEFAULT_SECTOR_CARD_METRICS } from '$lib/valuation/prefs';
	import SectorCard from '$lib/valuation/components/SectorCard.svelte';
	import SectorExport from '$lib/valuation/components/SectorExport.svelte';
	import type { SectorReturn } from '$lib/valuation/sectorRotation';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	// The person's own choice of figures on each card (saved on the server, see lib/prefs.ts).
	// svelte-ignore state_referenced_locally
	let cardMetrics = $state(data.prefs?.sectorCard.metrics ?? DEFAULT_SECTOR_CARD_METRICS);

	const IMPORT_SECTOR_EXAMPLE = `{
  "key": "renewable_storage",
  "label": "Renewable Energy Storage",
  "subsectors": [
    {
      "key": "battery_storage_bess",
      "label": "Battery Storage (BESS)",
      "symbols": ["EXIDEIND", "AMARAJABAT", "HBLENGINE"]
    },
    {
      "key": "pumped_hydro_storage",
      "label": "Pumped Hydro Storage",
      "symbols": ["NHPC", "SJVN"]
    }
  ]
}`;

	let importOpen = $state(false);
	let importText = $state('');
	let importing = $state(false);
	let importError = $state<string | null>(null);
	let importSuccessLabel = $state<string | null>(null);

	function onImportFileSelected(e: Event) {
		const input = e.target as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;
		const reader = new FileReader();
		reader.onload = () => {
			importText = String(reader.result ?? '');
		};
		reader.readAsText(file);
	}

	async function runSectorImport() {
		importing = true;
		importError = null;
		importSuccessLabel = null;

		let parsed: unknown;
		try {
			parsed = JSON.parse(importText);
		} catch (e) {
			importError = e instanceof Error ? `Invalid JSON: ${e.message}` : 'Invalid JSON.';
			importing = false;
			return;
		}

		try {
			const res = await fetch('/api/valuation/sector-rotation-import', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(parsed)
			});
			const body = await res.json().catch(() => null);
			if (!res.ok) {
				importError = body?.message ?? `Import failed (${res.status}).`;
				importing = false;
				return;
			}
			importSuccessLabel = body.key;
			importText = '';
			// Re-runs +page.server.ts's load, which now also reads the newly-imported sector from
			// Postgres — the grid's own $effect reacts to `data.majors` changing and fetches the
			// new card's rotation data the same way it does for every built-in major sector.
			await invalidateAll();
		} catch {
			importError = 'Could not reach the server — try again.';
		} finally {
			importing = false;
		}
	}

	type SortKey = 'label' | 'return1w' | 'return1m' | 'return3m' | 'return6m' | 'rs1m';
	const SORT_OPTIONS: { key: SortKey; label: string }[] = [
		{ key: 'rs1m', label: 'RS vs Nifty (1M)' },
		{ key: 'return1w', label: '1W return' },
		{ key: 'return1m', label: '1M return' },
		{ key: 'return3m', label: '3M return' },
		{ key: 'return6m', label: '6M return' },
		{ key: 'label', label: 'Name' }
	];
	let sortKey = $state<SortKey>('rs1m');
	let sortDir = $state<'asc' | 'desc'>('desc');
	// Cards stay in their static, unsorted order while progressively loading — re-sorting after
	// every single card arrives made the whole grid visibly reshuffle dozens of times in a row.
	// Once every card has loaded, the grid settles into sorted order in one smooth animated move
	// (see `shouldSort` below and `animate:flip` on the grid). An explicit sort action jumps the
	// gun on that and applies immediately, still via the same smooth flip transition.
	let userSorted = $state(false);

	function markUserSorted() {
		userSorted = true;
	}

	function toggleSortDir() {
		sortDir = sortDir === 'asc' ? 'desc' : 'asc';
		markUserSorted();
	}

	// Plain $state (not .raw) keyed by major sector — each rollup's fetch writes only its own
	// entry (majorData[key] = ...), a genuine in-place property set on the reactive proxy. Svelte
	// 5 tracks that at the property level, so a SectorCard reading a different key never re-runs
	// when this one resolves — updates stay scoped to the one card that actually changed.
	let majorData = $state<Record<string, SectorReturn | 'error' | undefined>>({});
	let loadedCount = $derived(Object.keys(majorData).length);
	// A 500 (e.g. Angel One credentials not configured) means every major sector will fail the
	// same way — stop hammering the other doomed requests and show one clear banner instead of
	// many identical per-card errors.
	let systemicError = $state<string | null>(null);

	// Fetched one at a time, in order — a real sequential loop, not every major sector fired at
	// once. Every major sector's rollup still ultimately queues through the same server-side
	// Angel One rate limiter regardless (via its subsectors' own constituent fetches), so this
	// isn't slower; it's what makes each card visibly complete on its own instead of the whole
	// grid waiting on the slowest one.
	$effect(() => {
		let cancelled = false;
		(async () => {
			for (const m of data.majors) {
				if (cancelled) return;
				try {
					const res = await fetch(`/api/valuation/sector-rotation-major/${m.key}`);
					if (res.status === 500) {
						const body = await res.json().catch(() => null);
						if (!cancelled)
							systemicError = body?.message ?? 'Sector data is unavailable right now.';
						return;
					}
					if (!res.ok) throw new Error('failed');
					const row: SectorReturn = await res.json();
					if (!cancelled) majorData[m.key] = row;
				} catch {
					if (!cancelled) majorData[m.key] = 'error';
				}
			}
		})();
		return () => {
			cancelled = true;
		};
	});

	function sortValue(key: string, sortByKey: SortKey): string | number | null {
		const row = majorData[key];
		if (sortByKey === 'label') return data.majors.find((m) => m.key === key)?.label ?? key;
		if (!row || row === 'error') return null;
		return row[sortByKey];
	}

	const allLoaded = $derived(loadedCount === data.majors.length);
	// Sort applies once loading has fully finished (a quiet, one-time settle), or immediately if
	// the user has explicitly picked a sort — otherwise the grid stays in its original order.
	const shouldSort = $derived(allLoaded || userSorted);

	const sortedMajors = $derived(
		shouldSort
			? [...data.majors].sort((a, b) => {
					const av = sortValue(a.key, sortKey);
					const bv = sortValue(b.key, sortKey);
					if (av == null && bv == null) return 0;
					if (av == null) return 1;
					if (bv == null) return -1;
					if (typeof av === 'string' && typeof bv === 'string') {
						return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
					}
					if (typeof av === 'number' && typeof bv === 'number') {
						return sortDir === 'asc' ? av - bv : bv - av;
					}
					return 0;
				})
			: data.majors
	);
</script>

<svelte:head>
	<title>Sector Rotation · Valuation Dashboard</title>
</svelte:head>

<div class="band">
	<div class="band-inner">
		<a class="back-link" href={resolve('/valuation')}>&larr; Back to search</a>
		<h1>Sector Rotation</h1>
		<div class="sub">
			Major sectors ranked by relative strength vs Nifty 50, each rolled up from its own thematic
			sub-baskets, live via Angel One —
			{loadedCount < data.majors.length
				? `loading ${loadedCount}/${data.majors.length}…`
				: 'up to date (cached up to 2h)'}
		</div>
	</div>
</div>

<div class="wrap">
	<!-- Editing the shared sector taxonomy is admin-only (enforced server-side too). -->
	{#if data.user?.role === 'admin'}
		<a class="sm-manage-link" href={resolve('/valuation/sectors')}
			>Manage sectors, baskets &amp; companies &rarr;</a
		>
		<div class="integrity-panel" style="margin-top:12px">
			<button class="integrity-toggle" onclick={() => (importOpen = !importOpen)}>
				<svg
					class="import-icon"
					width="15"
					height="15"
					viewBox="0 0 16 16"
					fill="none"
					stroke="currentColor"
					stroke-width="1.4"
					stroke-linecap="round"
					stroke-linejoin="round"
				>
					<path d="M8 2v7M5.2 6.2 8 9l2.8-2.8" />
					<path d="M2.5 10.5V13a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1v-2.5" />
				</svg>
				<span>Import sector (JSON)</span>
				<span class="integrity-caret">{importOpen ? '▲' : '▼'}</span>
			</button>
			{#if importOpen}
				<div class="import-body">
					<p class="import-hint">
						Paste JSON generated by Claude or any other tool, or upload a <code>.json</code> file.
						Needs a unique <code>key</code> and <code>label</code> for the new major sector, and a
						<code>subsectors</code> array — each with its own unique <code>key</code>,
						<code>label</code>, and a <code>symbols</code> list of real NSE trading symbols (as used
						elsewhere in this app, e.g. <code>"TCS"</code>, <code>"RELIANCE"</code>). A sector or
						subsector <code>key</code> that collides with an existing one (built-in or previously imported)
						is rejected — pick a different one.
					</p>
					<pre class="import-example">{IMPORT_SECTOR_EXAMPLE}</pre>
					<textarea
						class="import-textarea"
						rows="10"
						bind:value={importText}
						placeholder="Paste JSON here..."></textarea>
					<div class="import-actions">
						<input
							class="import-file"
							type="file"
							accept="application/json,.json"
							onchange={onImportFileSelected}
						/>
						<button
							class="diagnosis-apply"
							onclick={runSectorImport}
							disabled={importing || !importText.trim()}
						>
							{importing ? 'Importing…' : 'Import'}
						</button>
					</div>
					{#if importError}
						<ul class="integrity-list">
							<li class="signal-bad">
								<span class="integrity-detail">{importError}</span>
							</li>
						</ul>
					{/if}
					{#if importSuccessLabel}
						<ul class="integrity-list">
							<li class="signal-good">
								<span class="integrity-detail"
									>Imported "{importSuccessLabel}" — it now appears in the grid below.</span
								>
							</li>
						</ul>
					{/if}
				</div>
			{/if}
		</div>
	{/if}

	{#if systemicError}
		<div class="price-error" style="margin-top:20px">{systemicError}</div>
	{:else}
		<div class="depth-note" style="margin-top:20px">
			<strong>Rotating In</strong> = relative strength vs Nifty is accelerating (1M RS &gt; 3M RS
			&gt; 6M RS, and positive) — money is flowing into the sector faster now than 3 or 6 months
			ago. <strong>Rotating Out</strong> is the mirror case. Everything else reads "Neutral" — this is
			a momentum read on price, not a fundamental judgement.
		</div>

		<div class="sector-sort-bar">
			<span class="sector-sort-label">Sort by</span>
			<select
				class="sector-sort-select"
				aria-label="Sort by"
				bind:value={sortKey}
				onchange={markUserSorted}
			>
				{#each SORT_OPTIONS as opt (opt.key)}
					<option value={opt.key}>{opt.label}</option>
				{/each}
			</select>
			<button type="button" class="sector-sort-dir" onclick={toggleSortDir}>
				{sortDir === 'asc' ? '▲ Ascending' : '▼ Descending'}
			</button>
			<CardMetricsChooser metrics={cardMetrics} onChange={(m) => (cardMetrics = m)} />
			<SectorExport
				title="Sector rotation"
				filename="sector-rotation"
				countLabel="Sub-sectors"
				rows={sortedMajors.map((m) => ({ label: m.label, data: majorData[m.key] }))}
			/>
		</div>

		<div class="sector-card-grid">
			{#each sortedMajors as m (m.key)}
				<div class="sector-card-grid-item" animate:flip={{ duration: 350 }}>
					<SectorCard
						metrics={cardMetrics}
						label={m.label}
						tag={`sector · ${m.subsectorCount}`}
						row={majorData[m.key]}
						href={resolve('/valuation/sector-rotation/[key]', { key: m.key })}
						linkText={`${m.subsectorCount} sub-basket${m.subsectorCount === 1 ? '' : 's'} →`}
					/>
				</div>
			{/each}
		</div>
	{/if}
</div>
