<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import {
		snippetParts,
		type GlobalSearchResults,
		type SearchSector
	} from '$lib/valuation/globalSearch';

	// One box in the top bar that finds theses, companies, sectors and team notes across the whole
	// app. "/" focuses it from anywhere (except while typing in another field); arrows move, Enter
	// opens, Escape closes.
	let { compact = false }: { compact?: boolean } = $props();

	let query = $state('');
	let results = $state<GlobalSearchResults | null>(null);
	let loading = $state(false);
	let error = $state<string | null>(null);
	let open = $state(false);
	let active = $state(0);
	let input = $state<HTMLInputElement>();
	let timer: ReturnType<typeof setTimeout> | undefined;
	let controller: AbortController | undefined;

	interface Item {
		id: string;
		href: string;
	}

	const thesisHref = (id: string) => resolve('/company/[id]', { id });
	const companyHref = (symbol: string) => resolve('/valuation/company/[symbol]', { symbol });
	const sectorHref = (s: SearchSector) =>
		s.kind === 'major'
			? resolve('/valuation/sector-rotation/[key]', { key: s.key })
			: resolve('/valuation/sector-rotation/[key]/[subKey]', {
					key: s.parentKey!,
					subKey: s.key
				});
	const items = $derived.by((): Item[] => {
		if (!results) return [];
		return [
			...results.theses.map((t) => ({ id: `t-${t.companyId}`, href: thesisHref(t.companyId) })),
			...results.companies.map((c) => ({ id: `c-${c.symbol}`, href: companyHref(c.symbol) })),
			...results.sectors.map((s) => ({ id: `s-${s.kind}-${s.key}`, href: sectorHref(s) })),
			...results.notes.map((n) => ({ id: `n-${n.id}`, href: `${companyHref(n.symbol)}#team` }))
		];
	});
	const indexOf = (id: string) => items.findIndex((i) => i.id === id);

	function onInput() {
		clearTimeout(timer);
		open = true;
		active = 0;
		const q = query.trim();
		if (q.length < 2) {
			controller?.abort();
			results = null;
			loading = false;
			error = null;
			return;
		}
		loading = true;
		timer = setTimeout(() => void run(q), 200);
	}

	async function run(q: string) {
		controller?.abort();
		controller = new AbortController();
		try {
			const res = await fetch(`/api/valuation/search/all?q=${encodeURIComponent(q)}`, {
				signal: controller.signal
			});
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			results = (await res.json()) as GlobalSearchResults;
			error = null;
		} catch (e) {
			if ((e as Error).name === 'AbortError') return;
			error = 'Search is not available right now.';
		}
		loading = false;
	}

	function choose(href: string) {
		open = false;
		query = '';
		results = null;
		input?.blur();
		void goto(href);
	}

	function onKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			open = false;
			input?.blur();
		} else if (e.key === 'ArrowDown' && items.length) {
			e.preventDefault();
			open = true;
			active = (active + 1) % items.length;
		} else if (e.key === 'ArrowUp' && items.length) {
			e.preventDefault();
			active = (active - 1 + items.length) % items.length;
		} else if (e.key === 'Enter' && open && items[active]) {
			e.preventDefault();
			choose(items[active].href);
		}
	}

	function onGlobalKeydown(e: KeyboardEvent) {
		if (compact || e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
		const t = e.target as HTMLElement | null;
		if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
		e.preventDefault();
		input?.focus();
	}

	const KIND_LABEL = { thesis: 'Thesis', note: 'Note', comment: 'Comment' };
	const empty = $derived(
		results != null &&
			!results.theses.length &&
			!results.companies.length &&
			!results.sectors.length &&
			!results.notes.length
	);
	const inputId = $derived(compact ? 'global-search-input-m' : 'global-search-input');
	const listId = $derived(compact ? 'global-search-list-m' : 'global-search-list');
</script>

<svelte:window onkeydown={onGlobalKeydown} />

{#snippet option(id: string, href: string, label: string, meta: string, cls = '')}
	<a
		id="gs-{id}"
		role="option"
		aria-selected={items[active]?.id === id}
		class="gs-item {cls}"
		class:gs-active={items[active]?.id === id}
		{href}
		onmouseenter={() => (active = indexOf(id))}
		onclick={(e) => {
			e.preventDefault();
			choose(href);
		}}
	>
		<span class="gs-label">{label}</span>
		<span class="gs-meta">{meta}</span>
	</a>
{/snippet}

<div
	class="gs"
	class:gs-compact={compact}
	data-testid="global-search"
	onfocusout={(e) => {
		if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) open = false;
	}}
>
	<label class="sr-only" for={inputId}>Search theses, companies, sectors and notes</label>
	<svg class="gs-icon" width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
		<circle cx="7" cy="7" r="4.75" stroke="currentColor" stroke-width="1.75" />
		<path d="M10.5 10.5 14 14" stroke="currentColor" stroke-width="1.75" stroke-linecap="square" />
	</svg>
	<input
		id={inputId}
		bind:this={input}
		bind:value={query}
		type="search"
		autocomplete="off"
		placeholder="Search"
		title="Search theses, companies, sectors and notes. Press / from anywhere; ? lists all shortcuts."
		role="combobox"
		aria-expanded={open && query.trim().length >= 2}
		aria-controls={listId}
		aria-activedescendant={open && items[active] ? `gs-${items[active].id}` : undefined}
		oninput={onInput}
		onfocus={() => (open = true)}
		onkeydown={onKeydown}
	/>
	{#if !compact}<kbd class="gs-kbd" aria-hidden="true">/</kbd>{/if}
	{#if open && query.trim().length >= 2}
		<div class="gs-panel" id={listId} role="listbox" aria-label="Search results">
			{#if error}
				<p class="gs-msg" role="alert">{error}</p>
			{:else if !results}
				<p class="gs-msg">Searching…</p>
			{:else if empty}
				<p class="gs-msg">Nothing found for “{query.trim()}”.</p>
			{:else}
				{#if results.theses.length}
					<div class="gs-group" role="presentation">Theses</div>
					{#each results.theses as t (t.companyId)}
						{@render option(`t-${t.companyId}`, thesisHref(t.companyId), t.name, t.ticker ?? t.companyId)}
					{/each}
				{/if}
				{#if results.companies.length}
					<div class="gs-group" role="presentation">Valuation</div>
					{#each results.companies as c (c.symbol)}
						{@render option(
							`c-${c.symbol}`,
							companyHref(c.symbol),
							c.name,
							`${c.symbol}${c.onWatchlist ? ' · watchlist' : ''}`
						)}
					{/each}
				{/if}
				{#if results.sectors.length}
					<div class="gs-group" role="presentation">Sectors</div>
					{#each results.sectors as s (s.kind + s.key)}
						{@render option(
							`s-${s.kind}-${s.key}`,
							sectorHref(s),
							s.label,
							s.kind === 'major' ? 'Sector' : 'Basket'
						)}
					{/each}
				{/if}
				{#if results.notes.length}
					<div class="gs-group" role="presentation">Notes and discussion</div>
					{#each results.notes as n (n.id)}
						{@const id = `n-${n.id}`}
						<a
							id="gs-{id}"
							role="option"
							aria-selected={items[active]?.id === id}
							class="gs-item gs-note"
							class:gs-active={items[active]?.id === id}
							href="{companyHref(n.symbol)}#team"
							onmouseenter={() => (active = indexOf(id))}
							onclick={(e) => {
								e.preventDefault();
								choose(`${companyHref(n.symbol)}#team`);
							}}
						>
							<span class="gs-meta">{KIND_LABEL[n.kind]} on {n.companyName} · {n.author}</span>
							<span class="gs-snippet"
								>{#each snippetParts(n.snippet) as part, i (i)}{#if part.hit}<mark>{part.text}</mark
										>{:else}{part.text}{/if}{/each}</span
							>
						</a>
					{/each}
				{/if}
			{/if}
			{#if loading && results}<p class="gs-msg">Updating…</p>{/if}
		</div>
	{/if}
</div>
