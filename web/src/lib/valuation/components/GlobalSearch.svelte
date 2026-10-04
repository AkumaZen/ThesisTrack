<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { snippetParts, type GlobalSearchResults, type SearchSector } from '$lib/globalSearch';

	// One box in the top bar that finds companies, sectors and team notes. "/" focuses it from
	// anywhere (except while typing in another field); arrows move, Enter opens, Escape closes.
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

	const companyHref = (symbol: string) => resolve('/company/[symbol]', { symbol });
	const sectorHref = (s: SearchSector) =>
		s.kind === 'major'
			? resolve('/sector-rotation/[key]', { key: s.key })
			: resolve('/sector-rotation/[key]/[subKey]', { key: s.parentKey!, subKey: s.key });
	const items = $derived.by((): Item[] => {
		if (!results) return [];
		return [
			...results.companies.map((c) => ({ id: `c-${c.symbol}`, href: companyHref(c.symbol) })),
			...results.sectors.map((s) => ({
				id: `s-${s.kind}-${s.key}`,
				href: sectorHref(s)
			})),
			...results.notes.map((n) => ({
				id: `n-${n.id}`,
				href: `${companyHref(n.symbol)}#team`
			}))
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
			const res = await fetch(`/api/search/all?q=${encodeURIComponent(q)}`, {
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
		// eslint-disable-next-line svelte/no-navigation-without-resolve -- hrefs are built with resolve() above
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
		if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
		const t = e.target as HTMLElement | null;
		if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
		e.preventDefault();
		input?.focus();
	}

	const KIND_LABEL = { thesis: 'Thesis', note: 'Note', comment: 'Comment' };
	const empty = $derived(
		results != null && !results.companies.length && !results.sectors.length && !results.notes.length
	);
</script>

<svelte:window onkeydown={onGlobalKeydown} />

<div
	class="gsearch"
	data-testid="global-search"
	onfocusout={(e) => {
		if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) open = false;
	}}
>
	<label class="sr-only" for="global-search-input">Search companies, sectors and notes</label>
	<input
		id="global-search-input"
		bind:this={input}
		bind:value={query}
		type="search"
		autocomplete="off"
		placeholder="Search  /"
		title="Search companies, sectors and notes. Press / from anywhere; ? lists all shortcuts."
		role="combobox"
		aria-expanded={open && query.trim().length >= 2}
		aria-controls="global-search-list"
		aria-activedescendant={open && items[active] ? `gs-${items[active].id}` : undefined}
		oninput={onInput}
		onfocus={() => (open = true)}
		onkeydown={onKeydown}
	/>
	{#if open && query.trim().length >= 2}
		<div class="gsearch-panel" id="global-search-list" role="listbox" aria-label="Search results">
			{#if error}
				<p class="gsearch-msg" role="alert">{error}</p>
			{:else if !results}
				<p class="gsearch-msg">Searching…</p>
			{:else if empty}
				<p class="gsearch-msg">Nothing found for “{query.trim()}”.</p>
			{:else}
				{#if results.companies.length}
					<div class="gsearch-group" role="presentation">Companies</div>
					{#each results.companies as c (c.symbol)}
						{@const id = `c-${c.symbol}`}
						<a
							id="gs-{id}"
							role="option"
							aria-selected={items[active]?.id === id}
							class="gsearch-item"
							class:gsearch-active={items[active]?.id === id}
							href={companyHref(c.symbol)}
							onmouseenter={() => (active = indexOf(id))}
							onclick={(e) => {
								e.preventDefault();
								choose(companyHref(c.symbol));
							}}
						>
							<span>{c.name}</span>
							<span class="gsearch-meta">{c.symbol}{c.onWatchlist ? ' · on watchlist' : ''}</span>
						</a>
					{/each}
				{/if}
				{#if results.sectors.length}
					<div class="gsearch-group" role="presentation">Sectors</div>
					{#each results.sectors as s (s.kind + s.key)}
						{@const id = `s-${s.kind}-${s.key}`}
						<a
							id="gs-{id}"
							role="option"
							aria-selected={items[active]?.id === id}
							class="gsearch-item"
							class:gsearch-active={items[active]?.id === id}
							href={sectorHref(s)}
							onmouseenter={() => (active = indexOf(id))}
							onclick={(e) => {
								e.preventDefault();
								choose(sectorHref(s));
							}}
						>
							<span>{s.label}</span>
							<span class="gsearch-meta">{s.kind === 'major' ? 'Sector' : 'Sub-sector basket'}</span
							>
						</a>
					{/each}
				{/if}
				{#if results.notes.length}
					<div class="gsearch-group" role="presentation">Notes and discussion</div>
					{#each results.notes as n (n.id)}
						{@const id = `n-${n.id}`}
						<a
							id="gs-{id}"
							role="option"
							aria-selected={items[active]?.id === id}
							class="gsearch-item gsearch-note"
							class:gsearch-active={items[active]?.id === id}
							href="{companyHref(n.symbol)}#team"
							onmouseenter={() => (active = indexOf(id))}
							onclick={(e) => {
								e.preventDefault();
								choose(`${companyHref(n.symbol)}#team`);
							}}
						>
							<span class="gsearch-meta">{KIND_LABEL[n.kind]} on {n.companyName} · {n.author}</span>
							<span class="gsearch-snippet"
								>{#each snippetParts(n.snippet) as part, i (i)}{#if part.hit}<mark>{part.text}</mark
										>{:else}{part.text}{/if}{/each}</span
							>
						</a>
					{/each}
				{/if}
			{/if}
			{#if loading && results}<p class="gsearch-msg">Updating…</p>{/if}
		</div>
	{/if}
</div>
