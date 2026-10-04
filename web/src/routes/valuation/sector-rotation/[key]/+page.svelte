<script lang="ts">
	import { resolve } from '$app/paths';
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
	import { fetchCard, peekCard } from '$lib/valuation/cardCache';
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

	// Sort, open panels and scroll position are remembered per sector (see lib/viewMemory.ts).
	let strengthRef = $state<ReturnType<typeof StrengthPanel>>();
	const memory: ViewTracker<'sector'> = trackView({
		view: 'sector',
		userId: () => data.user?.id,
		scope: () => data.majorKey,
		read: () => ({ sort: sortKey, dir: sortDir, strength: strengthPanel, importer: false, page, pageSize }),
		apply: (s) => {
			sortKey = s.sort;
			sortDir = s.dir;
			strengthPanel = s.strength;
			page = 1;
			pageSize = DEFAULT_PAGE_SIZE;
			userSorted = false;
		}
	});

	// The person's own choice of figures on each card (saved on the server, see lib/prefs.ts).
	// svelte-ignore state_referenced_locally
	let cardMetrics = $state(data.prefs?.sectorCard.metrics ?? DEFAULT_SECTOR_CARD_METRICS);

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

	// Plain $state (not .raw) keyed by subsector - each load writes only its own entry, a genuine
	// in-place property set on the reactive proxy, so a card reading a different key never re-runs.
	// A card loads when it scrolls into view (or with Load all); loading it reads the stored prices
	// from the database and never calls Angel One. Answers are kept in the browser (cardCache.ts)
	// and reused, so paging, sorting or coming back to the page doesn't ask again.
	type CardState = SectorReturn | 'error' | 'loading' | undefined;
	let sectorData = $state<Record<string, CardState>>(
		untrack(() =>
			Object.fromEntries(
				data.subsectors.map((s) => s.key).flatMap((key) => {
					const hit = peekCard<SectorReturn>(`/api/valuation/sector-rotation/${key}`);
					return hit?.status === 200 && hit.body ? [[key, hit.body]] : [];
				})
			)
		)
	);
	const isRow = (v: CardState): v is SectorReturn => v != null && v !== 'error' && v !== 'loading';
	let loadedCount = $derived(Object.values(sectorData).filter(isRow).length);
	let systemicError = $state<string | null>(null);
	let refreshing = $state<Record<string, string | null>>({});

	async function loadSector(key: string, fresh = false) {
		if (sectorData[key] === 'loading') return;
		const previous = sectorData[key];
		if (!isRow(previous)) sectorData[key] = 'loading';
		try {
			const res = await fetchCard<SectorReturn & { message?: string }>(
				`/api/valuation/sector-rotation/${key}`,
				{ fresh }
			);
			if (res.status === 500) {
				systemicError = res.body?.message ?? 'Sector data is unavailable right now.';
				sectorData[key] = previous;
				return;
			}
			if (res.status !== 200 || !res.body) throw new Error('failed');
			sectorData[key] = res.body;
		} catch {
			sectorData[key] = isRow(previous) ? previous : 'error';
		}
	}

	/** Fetches fresh prices for the companies in one subsector, then shows the new figures. */
	async function refreshSectorCard(key: string) {
		refreshing[key] = 'Refreshing…';
		await refreshSector(key, (done, total) => (refreshing[key] = `Refreshing ${done}/${total}`));
		await loadSector(key, true);
		refreshing[key] = null;
	}

	let loadingAll = $state(false);
	/** Loads every card from the stored prices, two at a time (so Sort by return can rank them). */
	async function loadAll() {
		loadingAll = true;
		const pending = data.subsectors.map((s) => s.key).filter((k) => !isRow(sectorData[k]));
		await Promise.all(
			Array.from({ length: 2 }, async () => {
				for (let k = pending.shift(); k !== undefined; k = pending.shift()) await loadSector(k);
			})
		);
		loadingAll = false;
	}

	function sortValue(key: string, sortByKey: SortKey): string | number | null {
		const row = sectorData[key];
		if (sortByKey === 'label') return data.subsectors.find((s) => s.key === key)?.label ?? key;
		if (!isRow(row)) return null;
		return row[sortByKey];
	}

	const allLoaded = $derived(loadedCount === data.subsectors.length);
	// Sort applies once loading has fully finished (a quiet, one-time settle), or immediately if
	// the user has explicitly picked a sort — otherwise the grid stays in its original order.
	const shouldSort = $derived(allLoaded || userSorted);

	const sortedAll = $derived(
		shouldSort
			? [...data.subsectors].sort((a, b) => {
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
			: data.subsectors
	);
	const sortedSubsectors = $derived(sortedAll.filter((s) => passesStrength(strength, s.key)));

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
	const pageCount = $derived(Math.max(1, Math.ceil(sortedSubsectors.length / pageSize)));
	$effect(() => {
		if (page > pageCount) page = pageCount;
	});
	const pagedSubsectors = $derived(sortedSubsectors.slice((page - 1) * pageSize, page * pageSize));
</script>

<svelte:head>
	<title>{data.majorLabel} · Sector Rotation · ThesisTrack</title>
</svelte:head>

<div class="band">
	<div class="band-inner">
		<a class="back-link" href={resolve('/valuation/sector-rotation')}>&larr; Back to Sector Rotation</a>
		<h1>{data.majorLabel}</h1>
		<div class="sub">
			Thematic sub-baskets measured against Nifty 50. Charts load when you ask for them, from
			prices stored on the server (refreshed automatically after each weekday's close, or press Refresh on a card) —
			{loadedCount} of {data.subsectors.length} loaded
		</div>
	</div>
</div>

<div class="wrap">
	{#if systemicError}
		<div class="price-error" style="margin-top:20px">{systemicError}</div>
	{:else}
		<StrengthPanel
			bind:this={strengthRef}
			level="subsectors"
			parentKey={data.majorKey}
			kind="group"
			scopeLabel={`the subsectors of ${data.majorLabel}`}
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
				title={data.majorLabel}
				filename="sector-{data.majorKey}"
				countLabel="Companies"
				rows={sortedSubsectors.map((s) => ({ label: s.label, data: sectorData[s.key] }))}
			/>
		</div>

		{#if strength.active && strength.ready && !strength.error && sortedSubsectors.length === 0}
			<div class="depth-note" role="status">No subsector matches these filters. Loosen a threshold or clear the filters.</div>
		{/if}

		<div class="sector-card-grid">
			{#each pagedSubsectors as s (s.key)}
				<div class="sector-card-grid-item" animate:flip={{ duration: 350 }}>
					<SectorCard
						metrics={cardMetrics}
						evaluation={strength.active ? strength.byKey[s.key] : undefined}
						label={s.label}
						tag={`basket · ${s.constituentCount}`}
						row={sectorData[s.key]}
						onLoad={() => loadSector(s.key)}
						onRefresh={() => refreshSectorCard(s.key)}
						refreshing={refreshing[s.key] ?? null}
						href={resolve('/valuation/sector-rotation/[key]/[subKey]', { key: data.majorKey, subKey: s.key })}
						linkText={`${s.constituentCount} ${s.constituentCount === 1 ? 'company' : 'companies'}, individual charts & growth →`}
					/>
				</div>
			{/each}
		</div>
		<Pagination total={sortedSubsectors.length} bind:page bind:pageSize noun="subsectors" />
	{/if}
</div>
