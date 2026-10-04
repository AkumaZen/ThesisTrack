<script lang="ts">
	import type { SymbolHit } from '$lib/valuation/symbolSearch';

	// Search-as-you-type company picker, used wherever a company or symbol is chosen. Typing two or
	// more letters of a name or ticker lists matching companies (the team's own first, then the rest
	// of the market); picking one hands it to `onPick`, so nobody has to know or type a ticker.
	// Keyboard: arrows move, Enter picks, Escape closes.
	let {
		onPick,
		id,
		label,
		placeholder = 'Search a company by name or ticker',
		inputClass = '',
		value = $bindable(''),
		clearOnPick = true,
		disabled = false,
		autofocus = false
	}: {
		onPick: (hit: SymbolHit) => void;
		id: string;
		/** Accessible name for the field (shown by the caller's own <label for={id}>, or only to screen readers). */
		label: string;
		placeholder?: string;
		/** Extra classes so the field matches the page around it. */
		inputClass?: string;
		value?: string;
		clearOnPick?: boolean;
		disabled?: boolean;
		autofocus?: boolean;
	} = $props();

	let hits = $state<SymbolHit[]>([]);
	let open = $state(false);
	let loading = $state(false);
	let failed = $state(false);
	let active = $state(0);
	let input = $state<HTMLInputElement>();
	let timer: ReturnType<typeof setTimeout> | undefined;
	let controller: AbortController | undefined;
	let searched = $state('');

	const listId = $derived(`${id}-list`);
	const optionId = (i: number) => `${id}-opt-${i}`;

	function onInput() {
		clearTimeout(timer);
		const q = value.trim();
		active = 0;
		if (q.length < 2) {
			controller?.abort();
			hits = [];
			loading = false;
			failed = false;
			open = false;
			return;
		}
		open = true;
		loading = true;
		timer = setTimeout(() => void search(q), 200);
	}

	async function search(q: string) {
		controller?.abort();
		controller = new AbortController();
		try {
			const res = await fetch(`/api/valuation/symbol-search?q=${encodeURIComponent(q)}`, {
				signal: controller.signal
			});
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			hits = ((await res.json()) as { results: SymbolHit[] }).results;
			failed = false;
			searched = q;
		} catch (e) {
			if ((e as Error).name === 'AbortError') return;
			failed = true;
			hits = [];
		}
		loading = false;
	}

	function pick(hit: SymbolHit) {
		open = false;
		hits = [];
		value = clearOnPick ? '' : `${hit.name} (${hit.symbol})`;
		onPick(hit);
	}

	function onKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			open = false;
		} else if (e.key === 'ArrowDown' && hits.length) {
			e.preventDefault();
			open = true;
			active = (active + 1) % hits.length;
		} else if (e.key === 'ArrowUp' && hits.length) {
			e.preventDefault();
			active = (active - 1 + hits.length) % hits.length;
		} else if (e.key === 'Enter') {
			// Enter never submits a half-typed ticker: it picks the highlighted company, if any.
			e.preventDefault();
			if (open && hits[active]) pick(hits[active]);
		}
	}

	$effect(() => {
		if (autofocus) input?.focus();
	});
</script>

<div class="cp">
	<input
		bind:this={input}
		{id}
		class="cp-input {inputClass}"
		type="text"
		role="combobox"
		aria-label={label}
		aria-autocomplete="list"
		aria-expanded={open}
		aria-controls={listId}
		aria-activedescendant={open && hits[active] ? optionId(active) : undefined}
		autocomplete="off"
		spellcheck="false"
		{placeholder}
		{disabled}
		bind:value
		oninput={onInput}
		onkeydown={onKeydown}
		onfocus={() => value.trim().length >= 2 && hits.length && (open = true)}
		onblur={() => setTimeout(() => (open = false), 150)}
	/>
	{#if open}
		<div class="cp-pop">
			{#if hits.length}
				<ul class="cp-list" id={listId} role="listbox" aria-label="Companies matching {searched}">
					{#each hits as hit, i (hit.symbol)}
						<li
							id={optionId(i)}
							role="option"
							aria-selected={i === active}
							class="cp-opt"
							class:active={i === active}
							onmousedown={(e) => {
								e.preventDefault();
								pick(hit);
							}}
							onmouseenter={() => (active = i)}
						>
							<span class="cp-name">{hit.name}</span>
							<span class="cp-meta">
								<span class="cp-ticker">{hit.symbol}</span>
								{#if hit.tracked}<span class="cp-tag">Tracked</span>{/if}
								{#if hit.priceable === false}<span class="cp-tag cp-tag-warn">No price chart</span>{/if}
							</span>
						</li>
					{/each}
				</ul>
			{:else if loading}
				<p class="cp-note" role="status">Searching…</p>
			{:else if failed}
				<p class="cp-note" role="status">Search isn't available right now. Try again in a moment.</p>
			{:else}
				<p class="cp-note" role="status">No listed company matches "{value.trim()}".</p>
			{/if}
		</div>
	{/if}
</div>

<style>
	.cp {
		position: relative;
		width: 100%;
		min-width: 0;
	}
	.cp-input {
		width: 100%;
		font: inherit;
		font-size: 14px;
		padding: 8px 10px;
		border: var(--border-w) solid var(--ink);
		border-radius: 0;
		background: var(--bg);
		color: var(--ink);
	}
	.cp-input:focus-visible {
		outline: none;
		box-shadow: var(--focus-ring);
	}
	.cp-pop {
		position: absolute;
		z-index: 40;
		left: 0;
		right: 0;
		top: calc(100% + 4px);
		background: var(--bg);
		border: var(--border-w) solid var(--ink);
		box-shadow: var(--shadow-hard-sm);
		max-height: 340px;
		overflow-y: auto;
	}
	.cp-list {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.cp-opt {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		justify-content: space-between;
		gap: 2px 10px;
		padding: 8px 10px;
		cursor: pointer;
		border-bottom: 1px solid var(--rule);
		font-size: 14px;
		color: var(--ink);
	}
	.cp-opt:last-child {
		border-bottom: none;
	}
	.cp-opt.active {
		background: var(--accent-soft);
	}
	.cp-name {
		font-weight: 600;
		min-width: 0;
	}
	.cp-meta {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		flex-shrink: 0;
	}
	.cp-ticker {
		font-family: var(--font-mono, ui-monospace, monospace);
		font-size: 12px;
		color: var(--muted);
	}
	.cp-tag {
		font-size: 11px;
		padding: 1px 6px;
		border: 1px solid var(--ink);
		color: var(--ink);
	}
	.cp-tag-warn {
		border-color: var(--warn);
		color: var(--warn);
	}
	.cp-note {
		margin: 0;
		padding: 10px;
		font-size: 13px;
		color: var(--muted);
	}
</style>
