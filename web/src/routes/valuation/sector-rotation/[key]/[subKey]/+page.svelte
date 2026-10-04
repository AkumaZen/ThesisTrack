<script lang="ts">
	import '$lib/styles/dashboard.css';
	import { resolve } from '$app/paths';
	import ConstituentCard from '$lib/components/ConstituentCard.svelte';
	import { TIMEFRAMES, type Timeframe } from '$lib/sectorRotation';
	import type { SectorReturn } from '$lib/sectorRotation';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let timeframe = $state<Timeframe>('3M');

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
					const res = await fetch(`/api/company/${symbol}/growth-series`);
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
		fetch(`/api/sector-rotation/${data.key}`)
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

	function fmtPct(n: number | null) {
		return n == null ? '—' : `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`;
	}
</script>

<svelte:head>
	<title>{data.label} · {data.majorLabel} · Sector Rotation · Valuation Dashboard</title>
</svelte:head>

<div class="band">
	<div class="band-inner">
		<a class="back-link" href={resolve('/sector-rotation/[key]', { key: data.majorKey })}>
			&larr; Back to {data.majorLabel}
		</a>
		<h1>{data.label}</h1>
		{#if summary && summary !== 'error'}
			<div class="sub">
				Basket 1M {fmtPct(summary.return1m)} · 3M {fmtPct(summary.return3m)} ·
				<span
					class="wl-badge {summary.signal === 'Rotating In'
						? 'wl-pos-badge'
						: summary.signal === 'Rotating Out'
							? 'wl-neg-badge'
							: ''}">{summary.signal}</span
				>
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
	</div>

	<div class="constituent-grid">
		{#each data.symbols as symbol (symbol)}
			<ConstituentCard {symbol} closes={companyData[symbol]} {timeframe} />
		{/each}
	</div>
</div>
