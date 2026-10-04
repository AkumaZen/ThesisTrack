<script lang="ts">
	import { resolve } from '$app/paths';
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

	// Plain $state (not .raw) keyed by subsector — each basket's fetch writes only its own entry
	// (sectorData[key] = ...), a genuine in-place property set on the reactive proxy. Svelte 5
	// tracks that at the property level, so a SectorCard reading a different key never re-runs
	// when this one resolves — updates stay scoped to the one card that actually changed.
	let sectorData = $state<Record<string, SectorReturn | 'error' | undefined>>({});
	let loadedCount = $derived(Object.keys(sectorData).length);
	// A 500 (e.g. Angel One credentials not configured) means every basket will fail the same
	// way — stop hammering the other doomed requests and show one clear banner instead of many
	// identical per-card errors.
	let systemicError = $state<string | null>(null);

	// Fetched one at a time, in order — a real sequential loop, not one request per card fired at
	// once. Every basket still ultimately queues through the same server-side Angel One rate
	// limiter regardless of how the client requests them, so this isn't slower; it's what makes
	// each card visibly complete on its own instead of the whole grid waiting on the slowest one.
	$effect(() => {
		let cancelled = false;
		(async () => {
			for (const s of data.subsectors) {
				if (cancelled) return;
				try {
					const res = await fetch(`/api/valuation/sector-rotation/${s.key}`);
					if (res.status === 500) {
						const body = await res.json().catch(() => null);
						if (!cancelled)
							systemicError = body?.message ?? 'Sector data is unavailable right now.';
						return;
					}
					if (!res.ok) throw new Error('failed');
					const row: SectorReturn = await res.json();
					if (!cancelled) sectorData[s.key] = row;
				} catch {
					if (!cancelled) sectorData[s.key] = 'error';
				}
			}
		})();
		return () => {
			cancelled = true;
		};
	});

	function sortValue(key: string, sortByKey: SortKey): string | number | null {
		const row = sectorData[key];
		if (sortByKey === 'label') return data.subsectors.find((s) => s.key === key)?.label ?? key;
		if (!row || row === 'error') return null;
		return row[sortByKey];
	}

	const allLoaded = $derived(loadedCount === data.subsectors.length);
	// Sort applies once loading has fully finished (a quiet, one-time settle), or immediately if
	// the user has explicitly picked a sort — otherwise the grid stays in its original order.
	const shouldSort = $derived(allLoaded || userSorted);

	const sortedSubsectors = $derived(
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
</script>

<svelte:head>
	<title>{data.majorLabel} · Sector Rotation · ThesisTrack</title>
</svelte:head>

<div class="band">
	<div class="band-inner">
		<a class="back-link" href={resolve('/valuation/sector-rotation')}>&larr; Back to Sector Rotation</a>
		<h1>{data.majorLabel}</h1>
		<div class="sub">
			Thematic sub-baskets ranked by relative strength vs Nifty 50, live via Angel One —
			{loadedCount < data.subsectors.length
				? `loading ${loadedCount}/${data.subsectors.length}…`
				: 'up to date (cached up to 2h)'}
		</div>
	</div>
</div>

<div class="wrap">
	{#if systemicError}
		<div class="price-error" style="margin-top:20px">{systemicError}</div>
	{:else}
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
				title={data.majorLabel}
				filename="sector-{data.majorKey}"
				countLabel="Companies"
				rows={sortedSubsectors.map((s) => ({ label: s.label, data: sectorData[s.key] }))}
			/>
		</div>

		<div class="sector-card-grid">
			{#each sortedSubsectors as s (s.key)}
				<div class="sector-card-grid-item" animate:flip={{ duration: 350 }}>
					<SectorCard
						metrics={cardMetrics}
						label={s.label}
						tag={`basket · ${s.constituentCount}`}
						row={sectorData[s.key]}
						href={resolve('/valuation/sector-rotation/[key]/[subKey]', { key: data.majorKey, subKey: s.key })}
						linkText={`${s.constituentCount} ${s.constituentCount === 1 ? 'company' : 'companies'}, individual charts & growth →`}
					/>
				</div>
			{/each}
		</div>
	{/if}
</div>
