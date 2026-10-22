<script lang="ts">
	import type { NamedWatchlist } from '$lib/valuation/watchlists';

	// Puts one company on or off the person's own lists. `onChange` is awaited so the caller can
	// refresh the lists from the server (another analyst may have changed them meanwhile).
	let {
		symbol,
		name,
		lists,
		onChange,
		compact = false
	}: {
		symbol: string;
		name: string;
		lists: NamedWatchlist[];
		onChange: (listId: number, member: boolean) => Promise<string | null>;
		compact?: boolean;
	} = $props();

	let busy = $state(false);
	let error = $state<string | null>(null);
	const count = $derived(lists.filter((l) => l.symbols.includes(symbol)).length);

	async function toggle(list: NamedWatchlist, member: boolean) {
		busy = true;
		error = await onChange(list.id, member);
		busy = false;
	}
</script>

<details class="list-menu" class:compact data-testid="list-menu">
	<summary
		class={compact ? 'list-menu-trigger' : 'wl-strip-btn'}
		aria-label="Lists for {name}"
		title="Put {name} on one of your lists"
		>{compact
			? `Lists${count ? ` (${count})` : ''}`
			: `Lists${count ? ` (${count})` : ''} ▾`}</summary
	>
	<div class="list-menu-panel">
		{#if lists.length === 0}
			<p class="hint">No lists yet. Create one from the <a href="/valuation">watchlist</a>.</p>
		{:else}
			{#each lists as list (list.id)}
				<label>
					<input
						type="checkbox"
						checked={list.symbols.includes(symbol)}
						disabled={busy}
						onchange={(e) => toggle(list, (e.currentTarget as HTMLInputElement).checked)}
					/>
					{list.name}
				</label>
			{/each}
		{/if}
		{#if error}<p class="team-error" role="alert">{error}</p>{/if}
	</div>
</details>
