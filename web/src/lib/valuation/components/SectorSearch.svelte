<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { searchSectors, type SectorSearchEntry } from '$lib/valuation/sectorSearch';

	// Search box for Sector rotation: type part of a sector, subsector or company name (or a ticker)
	// and jump straight to it. A company opens the subsector it sits in. Everything comes from the
	// sector baskets the page already has, so it answers as you type with no requests.
	let { entries }: { entries: SectorSearchEntry[] } = $props();

	let query = $state('');
	let open = $state(false);
	let active = $state(0);
	const hits = $derived(searchSectors(entries, query));
	const optionId = (i: number) => `sector-search-opt-${i}`;

	function hrefOf(e: SectorSearchEntry): string {
		return e.kind === 'sector'
			? resolve('/valuation/sector-rotation/[key]', { key: e.majorKey })
			: resolve('/valuation/sector-rotation/[key]/[subKey]', { key: e.majorKey, subKey: e.subKey });
	}

	function choose(e: SectorSearchEntry) {
		open = false;
		query = '';
		void goto(hrefOf(e));
	}

	function onKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') open = false;
		else if (e.key === 'ArrowDown' && hits.length) {
			e.preventDefault();
			open = true;
			active = (active + 1) % hits.length;
		} else if (e.key === 'ArrowUp' && hits.length) {
			e.preventDefault();
			active = (active - 1 + hits.length) % hits.length;
		} else if (e.key === 'Enter' && hits[active]) {
			e.preventDefault();
			choose(hits[active]);
		}
	}

	const KIND = { sector: 'Sector', subsector: 'Subsector', company: 'Company' } as const;
</script>

<div class="ss" role="search">
	<label for="sector-search" class="ss-label">Search sectors, subsectors and companies</label>
	<input
		id="sector-search"
		class="ss-input"
		type="text"
		role="combobox"
		aria-autocomplete="list"
		aria-expanded={open && hits.length > 0}
		aria-controls="sector-search-list"
		aria-activedescendant={open && hits[active] ? optionId(active) : undefined}
		autocomplete="off"
		spellcheck="false"
		placeholder="e.g. Banking, Specialty Chemicals, HDFC Bank, TCS"
		bind:value={query}
		oninput={() => ((open = true), (active = 0))}
		onkeydown={onKeydown}
		onfocus={() => (open = true)}
		onblur={() => setTimeout(() => (open = false), 150)}
	/>
	{#if open && query.trim().length >= 2}
		<div class="ss-pop">
			{#if hits.length}
				<ul id="sector-search-list" role="listbox" aria-label="Matches" class="ss-list">
					{#each hits as h, i (h.kind + (h.kind === 'company' ? h.symbol + h.subKey : h.kind === 'subsector' ? h.subKey : h.majorKey))}
						<li
							id={optionId(i)}
							role="option"
							aria-selected={i === active}
							class="ss-opt"
							class:active={i === active}
							onmousedown={(e) => {
								e.preventDefault();
								choose(h);
							}}
							onmouseenter={() => (active = i)}
						>
							<span class="ss-kind">{KIND[h.kind]}</span>
							<span class="ss-main">
								<strong>{h.label}</strong>
								{#if h.kind === 'company'}<span class="ss-ticker">{h.symbol}</span>{/if}
							</span>
							<span class="ss-where">
								{#if h.kind === 'subsector'}in {h.majorLabel}
								{:else if h.kind === 'company'}in {h.subLabel} · {h.majorLabel}{/if}
							</span>
						</li>
					{/each}
				</ul>
			{:else}
				<p class="ss-note" role="status">
					Nothing in the sector baskets matches "{query.trim()}". To open any listed company, use
					Find a company on the Watchlist.
				</p>
			{/if}
		</div>
	{/if}
</div>

<style>
	.ss {
		position: relative;
		margin: 0 0 var(--space-4);
		max-width: 640px;
	}
	.ss-label {
		display: block;
		font-size: 13px;
		font-weight: 600;
		margin-bottom: 6px;
	}
	.ss-input {
		width: 100%;
		font: inherit;
		font-size: 15px;
		min-height: 44px;
		padding: 0 var(--space-3);
		border: var(--border-w) solid var(--ink);
		border-radius: 0;
		background: var(--bg);
		box-shadow: var(--shadow-hard-sm);
	}
	.ss-input:focus-visible {
		outline: none;
		box-shadow: var(--focus-ring);
	}
	.ss-pop {
		position: absolute;
		z-index: 40;
		left: 0;
		right: 0;
		top: calc(100% + 4px);
		background: var(--bg);
		border: var(--border-w) solid var(--ink);
		box-shadow: var(--shadow-hard-sm);
		max-height: 380px;
		overflow-y: auto;
	}
	.ss-list {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.ss-opt {
		display: grid;
		grid-template-columns: 82px 1fr;
		gap: 2px 10px;
		padding: 8px 10px;
		border-bottom: 1px solid var(--rule);
		cursor: pointer;
		font-size: 14px;
	}
	.ss-opt:last-child {
		border-bottom: none;
	}
	.ss-opt.active {
		background: var(--accent-soft);
	}
	.ss-kind {
		grid-row: span 2;
		font-size: 11px;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--muted);
		padding-top: 2px;
	}
	.ss-ticker {
		margin-left: 6px;
		font-family: var(--font-mono, monospace);
		font-size: 12px;
		color: var(--muted);
	}
	.ss-where {
		font-size: 12px;
		color: var(--muted);
	}
	.ss-note {
		margin: 0;
		padding: 10px;
		font-size: 13px;
		color: var(--muted);
	}
</style>
