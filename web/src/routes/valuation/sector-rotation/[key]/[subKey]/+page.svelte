<script lang="ts">
	import { resolve } from '$app/paths';
	import ConstituentCard from '$lib/valuation/components/ConstituentCard.svelte';
	import StrengthPanel from '$lib/valuation/components/StrengthPanel.svelte';
	import ViewResetButton from '$lib/valuation/components/ViewResetButton.svelte';
	import { trackView, type ViewTracker } from '$lib/viewMemory.svelte';
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
		read: () => ({ timeframe, strength: strengthPanel }),
		apply: (s) => {
			timeframe = s.timeframe;
			strengthPanel = s.strength;
		}
	});

	let timeframe = $state<Timeframe>(memory.initial.timeframe);
	let strengthPanel = $state(memory.initial.strength);
	let strength = $state(emptyStrengthView());
	const visibleSymbols = $derived(data.symbols.filter((s) => passesStrength(strength, s)));

	// Plain $state keyed by symbol — each company's own fetch writes only its own entry, so a
	// ConstituentCard reading a different symbol never re-renders when this one resolves.
	let companyData = $state<Record<string, number[] | null | 'error' | undefined>>({});
	let loadedCount = $derived(Object.keys(companyData).length);
	let summary = $state<SectorReturn | 'error' | undefined>(undefined);

	// Companies load one at a time, same reasoning as the overview page's baskets: every fetch
	// still queues through the same server-side rate limiter regardless, so this is what makes
	// each card complete independently instead of the whole basket waiting on the slowest name.
	$effect(() => {
		let cancelled = false;
		(async () => {
			for (const symbol of data.symbols) {
				if (cancelled) return;
				try {
					const res = await fetch(`/api/valuation/company/${symbol}/growth-series`);
					if (res.status === 404) {
						if (!cancelled) companyData[symbol] = null;
						continue;
					}
					if (!res.ok) throw new Error('failed');
					const body = await res.json();
					if (!cancelled) companyData[symbol] = body.closes ?? null;
				} catch {
					if (!cancelled) companyData[symbol] = 'error';
				}
			}
		})();
		return () => {
			cancelled = true;
		};
	});

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
		<h1>{data.label}</h1>
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
				{loadedCount < data.symbols.length
					? `Loading ${loadedCount}/${data.symbols.length} ${data.symbols.length === 1 ? 'company' : 'companies'}…`
					: `${data.symbols.length} ${data.symbols.length === 1 ? 'company' : 'companies'} in this basket`}
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
		<ViewResetButton onReset={resetThisView} />
	</div>

	{#if strength.active && strength.ready && !strength.error && visibleSymbols.length === 0}
		<div class="depth-note" role="status">No company matches these filters. Loosen a threshold or clear the filters.</div>
	{/if}

	<div class="constituent-grid">
		{#each visibleSymbols as symbol (symbol)}
			<ConstituentCard
				{symbol}
				closes={companyData[symbol]}
				{timeframe}
				evaluation={strength.active ? strength.byKey[symbol] : undefined}
			/>
		{/each}
	</div>
</div>
