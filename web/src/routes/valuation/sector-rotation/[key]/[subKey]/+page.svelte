<script lang="ts">
	import { resolve } from '$app/paths';
	import ConstituentCard from '$lib/valuation/components/ConstituentCard.svelte';
	import StrengthPanel from '$lib/valuation/components/StrengthPanel.svelte';
	import Pagination from '$lib/valuation/components/Pagination.svelte';
	import { untrack } from 'svelte';
	import { refreshSymbols } from '$lib/valuation/seriesRefresh';
	import ViewResetButton from '$lib/valuation/components/ViewResetButton.svelte';
	import { trackView, type ViewTracker } from '$lib/viewMemory.svelte';
	import { DEFAULT_PAGE_SIZE } from '$lib/viewMemory';
	import { emptyStrengthView, passesStrength } from '$lib/valuation/strength';
	import { TIMEFRAMES, type Timeframe } from '$lib/valuation/sectorRotation';
	import { rotationBadge, ROTATION_TONE_CLASS, type SectorReturn } from '$lib/valuation/sectorRotation';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	function resetThisView() {
		memory.reset();
		strengthRef?.reset();
	}

	// Chart range, open panels and scroll position are remembered per subsector (lib/viewMemory.ts).
	let strengthRef = $state<ReturnType<typeof StrengthPanel>>();
	const memory: ViewTracker<'subsector'> = trackView({
		view: 'subsector',
		userId: () => data.user?.id,
		scope: () => `${data.majorKey}/${data.key}`,
		read: () => ({ timeframe, strength: strengthPanel, page, pageSize }),
		apply: (s) => {
			timeframe = s.timeframe;
			strengthPanel = s.strength;
			page = 1;
			pageSize = DEFAULT_PAGE_SIZE;
		}
	});

	let timeframe = $state<Timeframe>(memory.initial.timeframe);
	let strengthPanel = $state(memory.initial.strength);
	let strength = $state(emptyStrengthView());
	const visibleSymbols = $derived(data.symbols.filter((s) => passesStrength(strength, s)));

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
	const pageCount = $derived(Math.max(1, Math.ceil(visibleSymbols.length / pageSize)));
	$effect(() => {
		if (page > pageCount) page = pageCount;
	});
	const pagedSymbols = $derived(visibleSymbols.slice((page - 1) * pageSize, page * pageSize));

	// Plain $state keyed by symbol - each load writes only its own entry, so a ConstituentCard
	// reading a different symbol never re-renders when this one resolves. A card is empty until
	// someone asks for it ("Show chart"); loading it reads the stored prices from the database and
	// never calls Angel One.
	type CardState = number[] | null | 'error' | 'loading' | undefined;
	let companyData = $state<Record<string, CardState>>({});
	let fetchedAt = $state<Record<string, number | null>>({});
	let refreshing = $state<Record<string, string | null>>({});
	let loadedCount = $derived(
		Object.values(companyData).filter((v) => Array.isArray(v) || v === null).length
	);
	let summary = $state<SectorReturn | 'error' | undefined>(undefined);

	async function loadCompany(symbol: string) {
		if (companyData[symbol] === 'loading') return;
		const previous = companyData[symbol];
		if (!Array.isArray(previous)) companyData[symbol] = 'loading';
		try {
			const res = await fetch(`/api/valuation/company/${encodeURIComponent(symbol)}/growth-series`);
			if (res.status === 404) {
				companyData[symbol] = null;
				return;
			}
			if (!res.ok) throw new Error('failed');
			const body = (await res.json()) as { closes?: number[]; fetchedAt?: number };
			companyData[symbol] = body.closes ?? null;
			fetchedAt[symbol] = body.fetchedAt ?? null;
		} catch {
			companyData[symbol] = Array.isArray(previous) ? previous : 'error';
		}
	}

	/** Fetches fresh prices for one company from Angel One, then shows them. */
	async function refreshCompany(symbol: string) {
		refreshing[symbol] = 'Refreshing…';
		await refreshSymbols([symbol], undefined, false);
		await loadCompany(symbol);
		refreshing[symbol] = null;
	}

	let loadingAll = $state(false);
	/** Loads every company in the basket from the stored prices, two at a time. */
	async function loadAll() {
		loadingAll = true;
		const pending = data.symbols.filter((s) => !Array.isArray(companyData[s]) && companyData[s] !== null);
		await Promise.all(
			Array.from({ length: 2 }, async () => {
				for (let k = pending.shift(); k !== undefined; k = pending.shift()) await loadCompany(k);
			})
		);
		loadingAll = false;
	}

	let refreshingAll = $state<string | null>(null);
	/** Fetches fresh prices for the whole basket, then shows them (companies already shown update). */
	async function refreshAll() {
		refreshingAll = 'Refreshing…';
		await refreshSymbols(data.symbols, (done, total) => (refreshingAll = `Refreshing ${done}/${total}`));
		await Promise.all(
			data.symbols.filter((s) => companyData[s] !== undefined).map((s) => loadCompany(s))
		);
		void fetch(`/api/valuation/sector-rotation/${data.key}`)
			.then((res) => (res.ok ? res.json() : Promise.reject()))
			.then((row) => (summary = row))
			.catch(() => {});
		refreshingAll = null;
	}

	// The basket-aggregate summary line reuses the same per-sector endpoint the subsector grid
	// page hits — no separate live computation, just one more cheap fetch off the same cache.
	$effect(() => {
		let cancelled = false;
		fetch(`/api/valuation/sector-rotation/${data.key}`)
			.then((res) => (res.ok ? res.json() : Promise.reject()))
			.then((row) => {
				if (!cancelled) summary = row;
			})
			.catch(() => {
				if (!cancelled) summary = 'error';
			});
		return () => {
			cancelled = true;
		};
	});

	const summaryBadge = $derived(summary && summary !== 'error' ? rotationBadge(summary) : null);

	function fmtPct(n: number | null) {
		return n == null ? '—' : `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`;
	}
</script>

<svelte:head>
	<title>{data.label} · {data.majorLabel} · Sector Rotation · ThesisTrack</title>
</svelte:head>

<div class="band">
	<div class="band-inner">
		<a class="back-link" href={resolve('/valuation/sector-rotation/[key]', { key: data.majorKey })}>
			&larr; Back to {data.majorLabel}
		</a>
		<h1 data-parent={data.majorLabel}>{data.label}</h1>
		{#if summary && summary !== 'error'}
			<div class="sub">
				Basket 1M {fmtPct(summary.return1m)} · 3M {fmtPct(summary.return3m)} ·
				{#if summaryBadge}
					<span class="wl-badge {ROTATION_TONE_CLASS[summaryBadge.tone]}" title={summaryBadge.title}
						>{summaryBadge.text}</span
					>
				{/if}
			</div>
		{:else}
			<div class="sub">
				{data.symbols.length} {data.symbols.length === 1 ? 'company' : 'companies'} in this basket ·
				{loadedCount} loaded
			</div>
		{/if}
	</div>
</div>

<div class="wrap">
	<div style="margin-top:20px">
		<StrengthPanel
			bind:this={strengthRef}
			level="companies"
			parentKey={data.key}
			kind="company"
			scopeLabel={`the companies in ${data.label}`}
			canSave={data.user?.role !== 'read_only'}
			bind:view={strength}
			bind:openState={strengthPanel}
		/>
	</div>

	<div class="timeframe-bar" style="margin-top:20px">
		<span class="sector-sort-label">Chart range</span>
		{#each TIMEFRAMES as tf (tf)}
			<button
				type="button"
				class="timeframe-btn"
				class:active={timeframe === tf}
				onclick={() => (timeframe = tf)}>{tf}</button
			>
		{/each}
		<button type="button" class="sector-sort-dir" disabled={loadingAll} onclick={loadAll}
			>{loadingAll ? 'Loading…' : 'Load all'}</button
		>
		<button type="button" class="sector-sort-dir" disabled={refreshingAll != null} onclick={refreshAll}
			>{refreshingAll ?? 'Refresh all'}</button
		>
		<ViewResetButton onReset={resetThisView} />
	</div>

	{#if strength.active && strength.ready && !strength.error && visibleSymbols.length === 0}
		<div class="depth-note" role="status">No company matches these filters. Loosen a threshold or clear the filters.</div>
	{/if}

	<div class="constituent-grid">
		{#each pagedSymbols as symbol (symbol)}
			<ConstituentCard
				{symbol}
				closes={companyData[symbol]}
				fetchedAt={fetchedAt[symbol] ?? null}
				onLoad={() => loadCompany(symbol)}
				onRefresh={() => refreshCompany(symbol)}
				refreshing={refreshing[symbol] ?? null}
				{timeframe}
				evaluation={strength.active ? strength.byKey[symbol] : undefined}
			/>
		{/each}
	</div>
	<Pagination total={visibleSymbols.length} bind:page bind:pageSize noun="companies" />
</div>
