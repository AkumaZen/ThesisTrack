<script lang="ts">
	import Trackables from '$lib/components/Trackables.svelte';
	import { trackView, type ViewTracker } from '$lib/viewMemory.svelte';
	import type { PageData } from './$types';
	let { data }: { data: PageData } = $props();
	// The search and the place on the page are remembered for this tab (lib/viewMemory.ts).
	const memory: ViewTracker<'reviewQueue'> = trackView({
		view: 'reviewQueue',
		userId: () => data.user?.id,
		read: () => ({ query }),
		apply: (s) => (query = s.query)
	});
	let query = $state(memory.initial.query);
	// Matches the company name, its id (ticker) or the trackable text.
	let visible = $derived.by(() => {
		const q = query.trim().toLocaleLowerCase();
		if (!q) return data.trackables;
		return data.trackables.filter((t) =>
			`${t.company_name} ${t.company_id} ${t.label}`.toLocaleLowerCase().includes(q)
		);
	});
	let groups = $derived.by(() => {
		const byCompany = new Map<string, { id: string; name: string; items: string[]; stale: boolean; reasons: string[] }>();
		for (const item of visible) {
			const group = byCompany.get(item.company_id) ?? { id: item.company_id, name: item.company_name, items: [], stale: !!item.stale, reasons: item.stale_reasons ?? [] };
			group.items.push(item.label);
			byCompany.set(item.company_id, group);
		}
		return [...byCompany.values()].sort((a, b) => a.name.localeCompare(b.name));
	});
</script>

<h1 class="page-title mb-1">Review queue</h1>
<p class="text-sm text-muted-fg mb-5">Trackables from your current theses, grouped by company. Amend a company's Trackables section to update this queue.</p>
{#if data.trackables.length}
	<div class="relative mb-5">
		<svg
			aria-hidden="true"
			class="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-fg"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="1.8"
		>
			<circle cx="11" cy="11" r="7" />
			<path d="m20 20-4-4" stroke-linecap="round" />
		</svg>
		<label class="sr-only" for="review-search">Search the review queue by company or item</label>
		<input
			id="review-search"
			type="search"
			bind:value={query}
			onkeydown={(event) => {
				if (event.key === 'Escape') query = '';
			}}
			placeholder="Search by company, ticker or item..."
			autocomplete="off"
			class="review-search w-full rounded-lg border border-border bg-bg py-2.5 pl-10 pr-10 text-sm outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20"
		/>
		{#if query}
			<button
				type="button"
				onclick={() => (query = '')}
				aria-label="Clear review queue search"
				class="absolute right-2 top-1/2 -translate-y-1/2 rounded-md px-2 py-1 text-lg leading-none text-muted-fg hover:bg-surface-3 hover:text-fg"
			>&times;</button>
		{/if}
	</div>
{/if}
<div class="space-y-4">
	{#each groups as group (group.id)}
		<section class="rounded-xl border border-border bg-surface p-5">
			<h3 class="font-semibold mb-3 flex flex-wrap items-center gap-2"><a class="hover:underline" href="/company/{encodeURIComponent(group.id)}#cp-sec-trackables">{group.name}</a>
				{#if group.stale}
					<span class="tag tag-warn" title={group.reasons.join('. ')}>Review due</span>
				{/if}</h3>
			<Trackables items={group.items} />
		</section>
	{:else}
		{#if data.trackables.length}
		<div class="rounded-xl border border-dashed border-border p-8 text-center text-muted-fg">
			No items match <strong class="text-fg">{query.trim()}</strong>
			<button type="button" onclick={() => (query = '')} class="mt-3 block mx-auto rounded-md border border-border px-3 py-1.5 text-sm hover:bg-surface-3">Clear search</button>
		</div>
		{:else}
		<div class="rounded-xl border border-border bg-surface p-8 text-center text-muted-fg">
			No trackables yet. Add entries to section 8 of your company thesis to see them here.
			<a href="/" class="block mt-3 text-sm text-fg underline">Browse companies</a>
		</div>
		{/if}
	{/each}
</div>

<style>
	/* Our own clear button replaces the browser's. */
	.review-search::-webkit-search-cancel-button {
		appearance: none;
		display: none;
	}
</style>
