<script lang="ts">
	import { resolve } from '$app/paths';
	import { invalidateAll } from '$app/navigation';
	import { flip } from 'svelte/animate';
	import CardMetricsChooser from '$lib/valuation/components/CardMetricsChooser.svelte';
	import { DEFAULT_SECTOR_CARD_METRICS } from '$lib/valuation/prefs';
	import SectorCard from '$lib/valuation/components/SectorCard.svelte';
	import SectorExport from '$lib/valuation/components/SectorExport.svelte';
	import StrengthPanel from '$lib/valuation/components/StrengthPanel.svelte';
	import Pagination from '$lib/valuation/components/Pagination.svelte';
	import { DEFAULT_PAGE_SIZE } from '$lib/viewMemory';
	import { untrack } from 'svelte';
	import { refreshSector } from '$lib/valuation/seriesRefresh';
	import SectorSearch from '$lib/valuation/components/SectorSearch.svelte';
	import ViewResetButton from '$lib/valuation/components/ViewResetButton.svelte';
	import { trackView, type ViewTracker } from '$lib/viewMemory.svelte';
	import { saveDefaultCardMetrics } from '$lib/valuation/viewReset';
	import { emptyStrengthView, passesStrength } from '$lib/valuation/strength';
	import type { SectorReturn } from '$lib/valuation/sectorRotation';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	async function resetThisView() {
		memory.reset();
		strengthRef?.reset();
		cardMetrics = [...DEFAULT_SECTOR_CARD_METRICS];
		await saveDefaultCardMetrics();
	}

	// Sort, open panels and scroll position are remembered for this person (see lib/viewMemory.ts).
	let strengthRef = $state<ReturnType<typeof StrengthPanel>>();
	const memory: ViewTracker<'sector'> = trackView({
		view: 'sector',
		userId: () => data.user?.id,
		read: () => ({ sort: sortKey, dir: sortDir, strength: strengthPanel, importer: importOpen, page, pageSize }),
		apply: (s) => {
			sortKey = s.sort;
			sortDir = s.dir;
			strengthPanel = s.strength;
			importOpen = s.importer;
			page = 1;
			pageSize = DEFAULT_PAGE_SIZE;
			userSorted = false;
		}
	});

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

	let importOpen = $state(memory.initial.importer);
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
	let sortKey = $state<SortKey>(memory.initial.sort);
	let sortDir = $state<'asc' | 'desc'>(memory.initial.dir);
	let strengthPanel = $state(memory.initial.strength);
	// Cards stay in their static, unsorted order while progressively loading — re-sorting after
	// every single card arrives made the whole grid visibly reshuffle dozens of times in a row.
	// Once every card has loaded, the grid settles into sorted order in one smooth animated move
	// (see `shouldSort` below and `animate:flip` on the grid). An explicit sort action jumps the
	// gun on that and applies immediately, still via the same smooth flip transition.
	// A sort restored from memory counts as chosen.
	let userSorted = $state(memory.initial.sort !== 'rs1m' || memory.initial.dir !== 'desc');
	let strength = $state(emptyStrengthView());

	function markUserSorted() {
		userSorted = true;
		page = 1;
	}

	function toggleSortDir() {
		sortDir = sortDir === 'asc' ? 'desc' : 'asc';
		markUserSorted();
	}

	// Plain $state (not .raw) keyed by major sector - each load writes only its own entry, a genuine
	// in-place property set on the reactive proxy, so a card reading a different key never re-runs.
	// A card is empty until someone asks for it ("Show chart"); loading it reads the stored prices
	// from the database and never calls Angel One.
	type CardState = SectorReturn | 'error' | 'loading' | undefined;
	let majorData = $state<Record<string, CardState>>({});
	const isRow = (v: CardState): v is SectorReturn => v != null && v !== 'error' && v !== 'loading';
	let loadedCount = $derived(Object.values(majorData).filter(isRow).length);
	let systemicError = $state<string | null>(null);
	let refreshing = $state<Record<string, string | null>>({});

	async function loadMajor(key: string) {
		if (majorData[key] === 'loading') return;
		const previous = majorData[key];
		if (!isRow(previous)) majorData[key] = 'loading';
		try {
			const res = await fetch(`/api/valuation/sector-rotation-major/${key}`);
			if (res.status === 500) {
				const body = await res.json().catch(() => null);
				systemicError = body?.message ?? 'Sector data is unavailable right now.';
				majorData[key] = previous;
				return;
			}
			if (!res.ok) throw new Error('failed');
			majorData[key] = (await res.json()) as SectorReturn;
		} catch {
			majorData[key] = isRow(previous) ? previous : 'error';
		}
	}

	/** Fetches fresh prices for the companies behind one sector, then shows the new figures. */
	async function refreshMajor(key: string) {
		refreshing[key] = 'Refreshing…';
		await refreshSector(key, (done, total) => (refreshing[key] = `Refreshing ${done}/${total}`));
		await loadMajor(key);
		refreshing[key] = null;
	}

	let loadingAll = $state(false);
	/** Loads every card from the stored prices, two at a time (so Sort by return can rank them). */
	async function loadAll() {
		loadingAll = true;
		const pending = data.majors.map((m) => m.key).filter((k) => !isRow(majorData[k]));
		await Promise.all(
			Array.from({ length: 2 }, async () => {
				for (let k = pending.shift(); k !== undefined; k = pending.shift()) await loadMajor(k);
			})
		);
		loadingAll = false;
	}

	function sortValue(key: string, sortByKey: SortKey): string | number | null {
		const row = majorData[key];
		if (sortByKey === 'label') return data.majors.find((m) => m.key === key)?.label ?? key;
		if (!isRow(row)) return null;
		return row[sortByKey];
	}

	const allLoaded = $derived(loadedCount === data.majors.length);
	// Sort applies once everything is loaded, or as soon as the person has picked a sort -
	// otherwise the grid stays in its original order and cards don't move as they are opened.
	const shouldSort = $derived(allLoaded || userSorted);

	const sortedAll = $derived(
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
	const sortedMajors = $derived(sortedAll.filter((m) => passesStrength(strength, m.key)));

	// Pagination: which page, and how many cards per page (remembered; see lib/viewMemory.ts).
	let page = $state(memory.initial.page);
	let pageSize = $state(memory.initial.pageSize);
	let strengthSeen = false;
	// A changed filter starts again from page 1 (the first result, when it was restored, is left alone).
	$effect(() => {
		const s = strength;
		untrack(() => {
			if (!strengthSeen) strengthSeen = s.ready;
			else page = 1;
		});
	});
	const pageCount = $derived(Math.max(1, Math.ceil(sortedMajors.length / pageSize)));
	$effect(() => {
		if (page > pageCount) page = pageCount;
	});
	const pagedMajors = $derived(sortedMajors.slice((page - 1) * pageSize, page * pageSize));
</script>

<svelte:head>
	<title>Sector Rotation · ThesisTrack</title>
</svelte:head>

<div class="band">
	<div class="band-inner">
		<h1>Sector rotation</h1>
		<div class="sub">
			Major sectors, each rolled up from its own thematic sub-baskets, measured against Nifty 50.
			Charts load when you ask for them, from prices stored on the server (refreshed automatically after
			each weekday's close, or press Refresh on a card) —
			{loadedCount} of {data.majors.length} loaded
		</div>
	</div>
</div>

<div class="wrap">
	<SectorSearch entries={data.search} />

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
			ago. <strong>Rotating Out</strong> is the mirror case. Otherwise the label says where 1M and 3M
			relative strength sit: <strong>Outperforming</strong> or <strong>Underperforming</strong> (same
			side of Nifty on both), <strong>Recovering</strong> (ahead over 1M after lagging over 3M) or
			<strong>Fading</strong> (the reverse). This is a momentum read on price, not a fundamental judgement.
		</div>

		<StrengthPanel
			bind:this={strengthRef}
			level="sectors"
			kind="group"
			scopeLabel="every sector"
			canSave={data.user?.role !== 'read_only'}
			bind:view={strength}
			bind:openState={strengthPanel}
		/>

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
			<button type="button" class="sector-sort-dir" disabled={loadingAll || allLoaded} onclick={loadAll}
				>{loadingAll ? 'Loading…' : allLoaded ? 'All loaded' : 'Load all'}</button
			>
			<ViewResetButton onReset={resetThisView} />
			<SectorExport
				title="Sector rotation"
				filename="sector-rotation"
				countLabel="Sub-sectors"
				rows={sortedMajors.map((m) => ({ label: m.label, data: majorData[m.key] }))}
			/>
		</div>

		{#if strength.active && strength.ready && !strength.error && sortedMajors.length === 0}
			<div class="depth-note" role="status">No sector matches these filters. Loosen a threshold or clear the filters.</div>
		{/if}

		<div class="sector-card-grid">
			{#each pagedMajors as m (m.key)}
				<div class="sector-card-grid-item" animate:flip={{ duration: 350 }}>
					<SectorCard
						metrics={cardMetrics}
						evaluation={strength.active ? strength.byKey[m.key] : undefined}
						label={m.label}
						tag={`sector · ${m.subsectorCount}`}
						row={majorData[m.key]}
						onLoad={() => loadMajor(m.key)}
						onRefresh={() => refreshMajor(m.key)}
						refreshing={refreshing[m.key] ?? null}
						href={resolve('/valuation/sector-rotation/[key]', { key: m.key })}
						linkText={`${m.subsectorCount} sub-basket${m.subsectorCount === 1 ? '' : 's'} →`}
					/>
				</div>
			{/each}
		</div>
		<Pagination total={sortedMajors.length} bind:page bind:pageSize noun="sectors" />
	{/if}
</div>
