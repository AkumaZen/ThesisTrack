<script lang="ts">
	import Trackables from '$lib/components/Trackables.svelte';
	import type { PageData } from './$types';
	let { data }: { data: PageData } = $props();
	let groups = $derived.by(() => {
		const byCompany = new Map<string, { id: string; name: string; items: string[] }>();
		for (const item of data.trackables) {
			const group = byCompany.get(item.company_id) ?? { id: item.company_id, name: item.company_name, items: [] };
			group.items.push(item.label);
			byCompany.set(item.company_id, group);
		}
		return [...byCompany.values()].sort((a, b) => a.name.localeCompare(b.name));
	});
</script>

<h2 class="text-xl font-semibold mb-1">Review Queue</h2>
<p class="text-sm text-muted-fg mb-5">Trackables from your current theses, grouped by company. Amend a company's Trackables section to update this queue.</p>
<div class="space-y-4">
	{#each groups as group (group.id)}
		<section class="rounded-xl border border-border bg-surface p-5">
			<h3 class="font-semibold mb-3"><a class="hover:underline" href="/company/{encodeURIComponent(group.id)}#cp-sec-trackables">{group.name}</a></h3>
			<Trackables items={group.items} />
		</section>
	{:else}
		<div class="rounded-xl border border-border bg-surface p-8 text-center text-muted-fg">
			No trackables yet. Add entries to section 8 of your company thesis to see them here.
			<a href="/" class="block mt-3 text-sm text-fg underline">Browse companies</a>
		</div>
	{/each}
</div>
